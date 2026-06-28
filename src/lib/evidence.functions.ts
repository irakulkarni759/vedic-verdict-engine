import { createServerFn } from "@tanstack/react-start";

export type EvidenceArticle = {
  pmid: string;
  title: string;
  journal: string;
  year: string;
  url: string;
};

export type EvidenceBullet = {
  text: string;
  url: string;
};

export type EvidenceVerdict = {
  query: string;
  verdict: "BACKED" | "MIXED" | "DEBUNKED" | "UNKNOWN";
  confidence: "high" | "moderate" | "low";
  oneLiner: string;
  studies: number;
  bullets: EvidenceBullet[];
  articles: EvidenceArticle[];
  pubmedSearchUrl: string;
  redditSearchUrl: string;
  generatedAt: string;
};

const EUTILS = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";

function pickTag(xml: string, tag: string): string | null {
  const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
  return m ? m[1].replace(/<[^>]+>/g, "").trim() : null;
}

function pickAll(xml: string, tag: string): string[] {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "g");
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) out.push(m[1].replace(/<[^>]+>/g, "").trim());
  return out;
}

function classifyAbstract(text: string): "pos" | "neg" | "neutral" {
  const t = text.toLowerCase();
  const pos = [
    "significant improvement", "significantly improved", "effective",
    "efficacy", "beneficial", "reduced", "reduction in", "improved",
    "supports", "associated with improvement", "positive effect",
  ];
  const neg = [
    "no significant", "not effective", "no evidence", "no benefit",
    "ineffective", "did not improve", "no difference",
    "insufficient evidence", "lack of evidence", "no effect",
  ];
  let p = 0, n = 0;
  for (const k of pos) if (t.includes(k)) p++;
  for (const k of neg) if (t.includes(k)) n++;
  if (p > n) return "pos";
  if (n > p) return "neg";
  return "neutral";
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function bestBullet(abstract: string): string | null {
  const sentences = abstract.split(/(?<=[.!?])\s+/);
  // prefer sentences with numbers/stats or outcome words
  const outcome = sentences.find(s =>
    s.length > 50 && s.length < 200 &&
    /(\d+%?|significant|improve|reduc|effect|associat|result)/i.test(s)
  );
  const fallback = sentences.find(s => s.length > 50 && s.length < 200);
  const best = outcome ?? fallback ?? sentences[0];
  if (!best) return null;
  return best
    .replace(/^[A-Z]{2,}[^a-z]*:\s*/, "")  // strip "BACKGROUND: " etc
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}

export const generateEvidenceVerdict = createServerFn({ method: "GET" })
  .inputValidator((d: { query: string }) => ({ query: String(d.query || "").slice(0, 200) }))
  .handler(async ({ data }): Promise<EvidenceVerdict> => {
    const query = data.query.trim();
    const pubmedSearchUrl = `https://pubmed.ncbi.nlm.nih.gov/?term=${encodeURIComponent(query)}`;
    const redditSearchUrl = `https://www.reddit.com/search/?q=${encodeURIComponent(query)}`;
    const generatedAt = new Date().toISOString();

    const empty = (msg: string): EvidenceVerdict => ({
      query,
      verdict: "UNKNOWN",
      confidence: "low",
      oneLiner: msg,
      studies: 0,
      bullets: [],
      articles: [],
      pubmedSearchUrl,
      redditSearchUrl,
      generatedAt,
    });

    if (!query) return empty("Enter a search to generate a verdict.");

    try {
      // Use Title/Abstract filter for tighter, more relevant results
      const searchTerm = `${query}[Title/Abstract]`;
      const esearch = await fetch(
        `${EUTILS}/esearch.fcgi?db=pubmed&retmode=json&retmax=8&sort=relevance&term=${encodeURIComponent(searchTerm)}`,
      );
      if (!esearch.ok) return empty("Couldn't reach PubMed right now. Try again in a moment.");

      const sj = (await esearch.json()) as { esearchresult?: { idlist?: string[]; count?: string } };
      const ids = sj.esearchresult?.idlist ?? [];
      if (ids.length === 0) {
        return { ...empty("No PubMed results — this one isn't well-studied yet."), verdict: "UNKNOWN" };
      }

      const efetch = await fetch(
        `${EUTILS}/efetch.fcgi?db=pubmed&retmode=xml&id=${ids.join(",")}`,
      );
      const xml = await efetch.text();
      const articleBlocks = xml.split(/<PubmedArticle[>\s]/).slice(1);

      const articles: EvidenceArticle[] = [];
      const bullets: EvidenceBullet[] = [];
      let pos = 0, neg = 0, neutral = 0;

      for (const raw of articleBlocks) {
        const block = decodeEntities(raw);
        const pmid = pickTag(block, "PMID") ?? "";
        const title = pickTag(block, "ArticleTitle") ?? "Untitled";
        const journal = pickTag(block, "Title") ?? "";
        const year = pickTag(block, "Year") ?? "";
        const abstractParts = pickAll(block, "AbstractText");
        const abstract = abstractParts.join(" ");
        if (!pmid) continue;

        const articleUrl = `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`;
        articles.push({ pmid, title, journal, year, url: articleUrl });

        if (abstract) {
          const cls = classifyAbstract(abstract);
          if (cls === "pos") pos++;
          else if (cls === "neg") neg++;
          else neutral++;

          if (bullets.length < 4) {
            const text = bestBullet(abstract);
            if (text) bullets.push({ text, url: articleUrl });
          }
        }
      }

      const studies = articles.length;
      const total = pos + neg + neutral || 1;
      let verdict: EvidenceVerdict["verdict"] = "MIXED";
      if (pos / total >= 0.55 && pos > neg) verdict = "BACKED";
      else if (neg / total >= 0.45 && neg > pos) verdict = "DEBUNKED";

      const confidence: EvidenceVerdict["confidence"] =
        studies >= 10 ? "high" : studies >= 4 ? "moderate" : "low";

      const oneLiner =
        verdict === "BACKED"
          ? `Across ${studies} PubMed studies, the bulk of findings support "${query}".`
          : verdict === "DEBUNKED"
          ? `Across ${studies} PubMed studies, the evidence largely fails to support "${query}".`
          : `Across ${studies} PubMed studies, findings are mixed for "${query}".`;

      return {
        query, verdict, confidence, oneLiner, studies,
        bullets, articles: articles.slice(0, 6),
        pubmedSearchUrl, redditSearchUrl, generatedAt,
      };
    } catch {
      return empty("Couldn't reach PubMed right now. Try again in a moment.");
    }
  });
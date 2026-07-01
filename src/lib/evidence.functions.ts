import { createServerFn } from "@tanstack/react-start";
import {
  CATEGORY_SLUGS,
  guessCategoryFallback,
  saveGeneratedTrend,
  slugify,
} from "./generatedTrends.functions";
import { toTitleCase } from "./utils";

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
  name: string;
  slug: string;
  category: string;
  verdict: "BACKED" | "MIXED" | "DEBUNKED" | "UNKNOWN";
  confidence: "high" | "moderate" | "low";
  oneLiner: string;
  studies: number;
  sentiment: number;
  updated: string;
  bullets: EvidenceBullet[];
  quotes: { handle: string; text: string }[];
  articles: EvidenceArticle[];
  pubmedSearchUrl: string;
  redditSearchUrl: string;
  generatedAt: string;
  /** Set when the direct query had zero PubMed hits and we fell back to
   *  searching its likely active ingredients instead (e.g. a branded product). */
  ingredientFallback: string[] | null;
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

async function generateBulletsAndQuotes(
  query: string,
  abstracts: { abstract: string; url: string }[]
): Promise<{
  bullets: EvidenceBullet[];
  quotes: { handle: string; text: string }[];
  sentiment: number;
  category: string;
}> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { bullets: [], quotes: [], sentiment: 50, category: guessCategoryFallback(query) };

  const abstractText = abstracts
    .map((a, i) => `[${i + 1}] (url: ${a.url})\n${a.abstract}`)
    .join("\n\n");

  const prompt = `You are a health research analyst. Given these PubMed abstracts about "${query}", return a JSON object with four fields:

1. "bullets": 3-4 key findings directly relevant to "${query}". Each finding: 1 sentence, 50-150 chars, specific with numbers/stats when available. Skip irrelevant abstracts.
2. "quotes": 2 realistic Reddit-style community quotes about "${query}" from real users. Short, conversational, opinionated. Each has a "handle" (like "@username") and "text".
3. "sentiment": a number 0-100 representing how positive the community sentiment is about "${query}" based on the evidence and typical user experience.
4. "category": the single best-fit category slug for "${query}", chosen ONLY from this exact list: ${CATEGORY_SLUGS.join(", ")}.

Abstracts:
${abstractText}

Return ONLY this JSON shape, no other text:
{
  "bullets": [{"text": "...", "index": 1}, ...],
  "quotes": [{"handle": "@username", "text": "..."}, ...],
  "sentiment": 75,
  "category": "supplements"
}`;

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 800,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    const json = await res.json() as { content: { text: string }[] };
    const text = json.content?.[0]?.text ?? "{}";
    const parsed = JSON.parse(text.replace(/```json|```/g, "").trim()) as {
      bullets: { text: string; index: number }[];
      quotes: { handle: string; text: string }[];
      sentiment: number;
      category?: string;
    };

    const bullets = (parsed.bullets ?? []).map((item) => ({
      text: item.text,
      url: abstracts[item.index - 1]?.url ?? abstracts[0]?.url,
    }));

    const category = parsed.category && CATEGORY_SLUGS.includes(parsed.category)
      ? parsed.category
      : guessCategoryFallback(query);

    return { bullets, quotes: parsed.quotes ?? [], sentiment: parsed.sentiment ?? 50, category };
  } catch {
    return { bullets: [], quotes: [], sentiment: 50, category: guessCategoryFallback(query) };
  }
}

/**
 * Called only when a direct PubMed search returns zero hits. Determines
 * whether the query is likely a branded/commercial product (which PubMed
 * will never index by name) and, if so, returns its most likely active
 * ingredients so we can retry the search against those instead.
 */
async function identifyIngredients(query: string): Promise<string[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return [];

  const prompt = `"${query}" returned zero results on a direct PubMed search. This usually means it's a specific commercial/branded product (PubMed indexes research, not product names).

If "${query}" is a specific branded or commercial product, list its 2-4 most likely active/key ingredients as plain scientific or common names suitable for a PubMed search query (e.g. "centella asiatica", "niacinamide", "zinc oxide").

If "${query}" is already a generic ingredient, supplement, food, or activity (not a specific branded product) — meaning a PubMed search genuinely turned up nothing relevant — return an empty ingredients list.

Return ONLY this JSON shape, no other text:
{"isProduct": true, "ingredients": ["centella asiatica", "zinc oxide"]}`;

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 300,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    const json = (await res.json()) as { content: { text: string }[] };
    const text = json.content?.[0]?.text ?? "{}";
    const parsed = JSON.parse(text.replace(/```json|```/g, "").trim()) as {
      isProduct?: boolean;
      ingredients?: string[];
    };

    if (!parsed.isProduct) return [];
    return (parsed.ingredients ?? []).filter(Boolean).slice(0, 4);
  } catch {
    return [];
  }
}

async function buildResultFromIds(opts: {
  ids: string[];
  query: string;
  name: string;
  slug: string;
  updated: string;
  generatedAt: string;
  pubmedSearchUrl: string;
  redditSearchUrl: string;
  ingredientFallback: string[] | null;
}): Promise<EvidenceVerdict> {
  const { ids, query, name, slug, updated, generatedAt, pubmedSearchUrl, redditSearchUrl, ingredientFallback } = opts;

  const efetch = await fetch(`${EUTILS}/efetch.fcgi?db=pubmed&retmode=xml&id=${ids.join(",")}`);
  const xml = await efetch.text();
  const articleBlocks = xml.split(/<PubmedArticle[>\s]/).slice(1);

  const articles: EvidenceArticle[] = [];
  const abstractsForClaude: { abstract: string; url: string }[] = [];
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
      abstractsForClaude.push({ abstract: abstract.slice(0, 800), url: articleUrl });
    }
  }

  const studies = articles.length;
  const total = pos + neg + neutral || 1;
  let verdict: EvidenceVerdict["verdict"] = "MIXED";
  if (pos / total >= 0.55 && pos > neg) verdict = "BACKED";
  else if (neg / total >= 0.45 && neg > pos) verdict = "DEBUNKED";

  const confidence: EvidenceVerdict["confidence"] =
    studies >= 10 ? "high" : studies >= 4 ? "moderate" : "low";

  const subjectLabel = ingredientFallback
    ? `its key ingredients (${ingredientFallback.map(toTitleCase).join(", ")})`
    : `"${name}"`;

  const verdictClause =
    verdict === "BACKED"
      ? `the bulk of findings support ${subjectLabel}`
      : verdict === "DEBUNKED"
      ? `the evidence largely fails to support ${subjectLabel}`
      : `findings are mixed for ${subjectLabel}`;

  const oneLiner = ingredientFallback
    ? `No direct studies on "${name}" as a product. Across ${studies} PubMed studies, ${verdictClause}.`
    : `Across ${studies} PubMed studies, ${verdictClause}.`;

  const searchSubject = ingredientFallback ? ingredientFallback.join(" ") : query;
  const { bullets, quotes, sentiment, category } = await generateBulletsAndQuotes(searchSubject, abstractsForClaude);

  await saveGeneratedTrend({
    data: {
      slug, query, name, category, verdict: verdict.toLowerCase() as "backed" | "mixed" | "debunked",
      summary: oneLiner, studyCount: studies, confidence, updated,
      evidencePoints: bullets.map((b) => b.text), sentiment, opinions: quotes,
      sourceUrls: articles.slice(0, 6).map((a) => a.url),
    },
  });

  return {
    query, name, slug, category, verdict, confidence, oneLiner, studies,
    sentiment, updated,
    bullets, quotes, articles: articles.slice(0, 6),
    pubmedSearchUrl, redditSearchUrl, generatedAt, ingredientFallback,
  };
}

export const generateEvidenceVerdict = createServerFn({ method: "GET" })
  .inputValidator((d: { query: string }) => ({ query: String(d.query || "").slice(0, 200) }))
  .handler(async ({ data }): Promise<EvidenceVerdict> => {
    const query = data.query.trim();
    const name = toTitleCase(query);
    const slug = slugify(query);
    const pubmedSearchUrl = `https://pubmed.ncbi.nlm.nih.gov/?term=${encodeURIComponent(query)}`;
    const redditSearchUrl = `https://www.reddit.com/search/?q=${encodeURIComponent(query)}`;
    const generatedAt = new Date().toISOString();
    const updated = new Date().toISOString().split("T")[0];

    const empty = (msg: string): EvidenceVerdict => ({
      query, name, slug, category: guessCategoryFallback(query), verdict: "UNKNOWN", confidence: "low",
      oneLiner: msg, studies: 0, sentiment: 0, updated,
      bullets: [], quotes: [], articles: [],
      pubmedSearchUrl, redditSearchUrl, generatedAt, ingredientFallback: null,
    });

    if (!query) return empty("Enter a search to generate a verdict.");

    try {
      const esearch = await fetch(
        `${EUTILS}/esearch.fcgi?db=pubmed&retmode=json&retmax=8&sort=relevance&term=${encodeURIComponent(query)}`,
      );
      if (!esearch.ok) return empty("Couldn't reach PubMed right now. Try again in a moment.");

      const sj = (await esearch.json()) as { esearchresult?: { idlist?: string[] } };
      const ids = sj.esearchresult?.idlist ?? [];

      if (ids.length === 0) {
        // Zero direct hits usually means this is a branded/commercial product —
        // PubMed indexes research, not product names. Try its likely active
        // ingredients before giving up.
        const ingredients = await identifyIngredients(query);

        if (ingredients.length > 0) {
          const fallbackTerm = ingredients.join(" OR ");
          const fallbackSearch = await fetch(
            `${EUTILS}/esearch.fcgi?db=pubmed&retmode=json&retmax=8&sort=relevance&term=${encodeURIComponent(fallbackTerm)}`,
          );

          if (fallbackSearch.ok) {
            const fsj = (await fallbackSearch.json()) as { esearchresult?: { idlist?: string[] } };
            const fallbackIds = fsj.esearchresult?.idlist ?? [];

            if (fallbackIds.length > 0) {
              return await buildResultFromIds({
                ids: fallbackIds,
                query, name, slug, updated, generatedAt,
                pubmedSearchUrl: `https://pubmed.ncbi.nlm.nih.gov/?term=${encodeURIComponent(fallbackTerm)}`,
                redditSearchUrl,
                ingredientFallback: ingredients,
              });
            }
          }
        }

        const result = { ...empty("No PubMed results — this one isn't well-studied yet."), verdict: "UNKNOWN" as const };
        // Still record the attempt, so it counts toward "trends searched" — but
        // as "unmapped" so it never renders as a real verdict card anywhere.
        await saveGeneratedTrend({
          data: {
            slug, query, name, category: result.category, verdict: "unmapped",
            summary: result.oneLiner, studyCount: 0, confidence: "low", updated,
            evidencePoints: [], sentiment: 0, opinions: [], sourceUrls: [pubmedSearchUrl],
          },
        });
        return result;
      }

      return await buildResultFromIds({
        ids, query, name, slug, updated, generatedAt,
        pubmedSearchUrl, redditSearchUrl, ingredientFallback: null,
      });
    } catch {
      return empty("Couldn't reach PubMed right now. Try again in a moment.");
    }
  });
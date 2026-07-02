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
  verdict: "BACKED" | "MIXED" | "DEBUNKED" | "UNKNOWN" | "PHARMA";
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
  displayName: string | null;
  bullets: EvidenceBullet[];
  quotes: { handle: string; text: string }[];
  sentiment: number;
  category: string;
  verdict: "BACKED" | "MIXED" | "DEBUNKED" | null;
}> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { displayName: null, bullets: [], quotes: [], sentiment: 50, category: guessCategoryFallback(query), verdict: null };
  }

  const abstractText = abstracts
    .map((a, i) => `[${i + 1}] (url: ${a.url})\n${a.abstract}`)
    .join("\n\n");

  const prompt = `You are a health research analyst. Given these PubMed abstracts about "${query}", return a JSON object with six fields:

1. "displayName": a standardized title in the exact form "X for Y" — X is the ingredient/product/practice being searched, Y is the specific outcome or purpose it's being evaluated for (e.g. "Rosemary Oil for Hair Growth"). If "${query}" already states a purpose, clean it up into this form (title case, no trailing punctuation). If it doesn't state one, infer the single most common/notable purpose people search this for, based on the abstracts and general knowledge — never leave Y generic like "for Health" or "for Wellness"; be specific (e.g. "for Hair Growth", "for Sleep Quality", "for Inflammation").
2. "verdict": your overall read of the evidence, one of "BACKED" (the bulk of studies support it working/being beneficial), "MIXED" (evidence is genuinely split or inconclusive), or "DEBUNKED" (the bulk of studies contradict it or find no effect). Base this on your actual understanding of what each abstract found, not just keyword counting — e.g. abstracts describing consistent, specific mechanisms and positive outcomes across most studies should read as BACKED even if few use the literal phrase "significant improvement".
3. "bullets": 3-4 key findings directly relevant to "${query}". Each finding: 1 sentence, 50-150 chars, specific with numbers/stats when available. Skip irrelevant abstracts.
4. "quotes": 2 realistic Reddit-style community quotes about "${query}" from real users. Short, conversational, opinionated. Each has a "handle" (like "@username") and "text".
5. "sentiment": a number 0-100 representing how positive the community sentiment is about "${query}" based on the evidence and typical user experience.
6. "category": the single best-fit category slug for "${query}", chosen ONLY from this exact list: ${CATEGORY_SLUGS.join(", ")}.

Abstracts:
${abstractText}

Return ONLY this JSON shape, no other text:
{
  "displayName": "Rosemary Oil for Hair Growth",
  "verdict": "BACKED",
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
      displayName?: string;
      verdict?: string;
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

    const verdict =
      parsed.verdict === "BACKED" || parsed.verdict === "MIXED" || parsed.verdict === "DEBUNKED"
        ? parsed.verdict
        : null;

    const displayName =
      typeof parsed.displayName === "string" && /\bfor\b/i.test(parsed.displayName)
        ? toTitleCase(parsed.displayName)
        : null;

    return { displayName, bullets, quotes: parsed.quotes ?? [], sentiment: parsed.sentiment ?? 50, category, verdict };
  } catch {
    return { displayName: null, bullets: [], quotes: [], sentiment: 50, category: guessCategoryFallback(query), verdict: null };
  }
}

type FallbackReason = "product" | "terminology";

type FallbackTerms = {
  reason: FallbackReason;
  terms: string[];
};

/**
 * Called only when a direct PubMed search returns zero hits. Two cases:
 *
 * 1. "product" — the query is a branded/commercial product (PubMed indexes
 *    research, not product names). Returns its most likely active ingredients.
 * 2. "terminology" — the query is a real, studied practice or ingredient
 *    described in colloquial wellness-culture phrasing that doesn't match
 *    PubMed's academic indexing terms (e.g. "cold plunging" vs "cold water
 *    immersion", "de-stressing" vs "stress reduction cortisol"). Returns the
 *    scientific/academic search terms most likely to surface real research.
 *
 * Returns null if the query is genuinely obscure/novel with no findable
 * research under any framing.
 */
async function identifyFallbackTerms(query: string): Promise<FallbackTerms | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  const prompt = `"${query}" returned zero results on a direct PubMed search. PubMed only indexes academic literature, so this happens for two common reasons — figure out which one applies, if either:

1. PRODUCT: "${query}" is a specific branded/commercial product. PubMed won't index it by name, but its active ingredients likely are studied.
2. TERMINOLOGY: "${query}" describes a real practice, ingredient, or activity using colloquial/wellness-culture phrasing that doesn't match academic vocabulary (e.g. "cold plunging" → "cold water immersion", "gut health" → "gut microbiota", "de-stressing" → "stress reduction cortisol"). The underlying topic likely does have real research under different search terms.

If neither applies — "${query}" is already phrased in a way that should have matched relevant research, and genuinely doesn't (obscure, novel, or nonsensical) — return "reason": null.

Return ONLY this JSON shape, no other text:
{"reason": "product", "terms": ["centella asiatica", "zinc oxide"]}
or
{"reason": "terminology", "terms": ["cold water immersion", "deliberate cold exposure stress"]}
or
{"reason": null, "terms": []}

"terms" should be 2-4 plain scientific/academic search phrases suitable for a PubMed query.`;

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
      reason?: FallbackReason | null;
      terms?: string[];
    };

    if (parsed.reason !== "product" && parsed.reason !== "terminology") return null;
    const terms = (parsed.terms ?? []).filter(Boolean).slice(0, 4);
    if (terms.length === 0) return null;

    return { reason: parsed.reason, terms };
  } catch {
    return null;
  }
}

/**
 * Veda covers supplements, wellness practices, and cosmetic ingredients —
 * not pharmaceutical medicines. Prescription and OTC drugs need a doctor
 * or pharmacist, not a BACKED/MIXED/DEBUNKED verdict, so this runs before
 * the PubMed pipeline and short-circuits with a clear "not covered" message.
 * Fails open (returns not-a-medicine) on any error so an API hiccup never
 * blocks a legitimate search.
 */
async function checkIsPharmaceutical(query: string): Promise<{ isMedicine: boolean; name?: string }> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { isMedicine: false };

  const prompt = `Is "${query}" primarily a pharmaceutical medicine — a prescription drug or a regulator-approved over-the-counter medicine (examples: ibuprofen, metformin, Ozempic, amoxicillin, Prozac, insulin, Tylenol)?

Answer "yes" ONLY for actual medicines/drugs used to treat or manage a diagnosed condition. Answer "no" for supplements, vitamins, herbs, cosmetic ingredients, foods, and general wellness practices — even ones that sound clinical (e.g. "melatonin", "creatine", "electrolytes", "collagen" are NOT medicines for this purpose).

Return ONLY this JSON, no other text:
{"is_medicine": true, "name": "common name of the medicine"}
or
{"is_medicine": false}`;

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
        max_tokens: 100,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    const json = (await res.json()) as { content: { text: string }[] };
    const text = json.content?.[0]?.text ?? "{}";
    const parsed = JSON.parse(text.replace(/```json|```/g, "").trim()) as {
      is_medicine?: boolean;
      name?: string;
    };

    return parsed.is_medicine === true
      ? { isMedicine: true, name: parsed.name }
      : { isMedicine: false };
  } catch {
    return { isMedicine: false };
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
  fallback: FallbackTerms | null;
}): Promise<EvidenceVerdict> {
  const { ids, query, name, slug, updated, generatedAt, pubmedSearchUrl, redditSearchUrl, fallback } = opts;

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
  let keywordVerdict: EvidenceVerdict["verdict"] = "MIXED";
  if (pos / total >= 0.55 && pos > neg) keywordVerdict = "BACKED";
  else if (neg / total >= 0.45 && neg > pos) keywordVerdict = "DEBUNKED";

  const confidence: EvidenceVerdict["confidence"] =
    studies >= 10 ? "high" : studies >= 4 ? "moderate" : "low";

  const searchSubject = fallback ? fallback.terms.join(" ") : query;
  const { displayName, bullets, quotes, sentiment, category, verdict: claudeVerdict } =
    await generateBulletsAndQuotes(searchSubject, abstractsForClaude);

  // Standardize the displayed title to "X for Y" — either Claude's inferred
  // purpose, or the raw title-cased query/name as a fallback when Claude
  // isn't available or didn't return a usable one.
  const finalName = displayName ?? name;

  // Claude reads and understands every abstract to write the bullets, so its
  // verdict reflects that same understanding. The keyword scan is a much
  // cruder signal (literal phrase matching) — only fall back to it when
  // Claude's call fails or there's no API key configured.
  const verdict = claudeVerdict ?? keywordVerdict;

  const termsLabel = fallback ? fallback.terms.map(toTitleCase).join(", ") : "";
  const subjectLabel =
    fallback?.reason === "product"
      ? `its key ingredients (${termsLabel})`
      : fallback?.reason === "terminology"
      ? `related research (${termsLabel})`
      : `"${finalName}"`;

  const verdictClause =
    verdict === "BACKED"
      ? `the bulk of findings support ${subjectLabel}`
      : verdict === "DEBUNKED"
      ? `the evidence largely fails to support ${subjectLabel}`
      : `findings are mixed for ${subjectLabel}`;

  const prefix =
    fallback?.reason === "product"
      ? `No direct studies on "${finalName}" as a product. `
      : fallback?.reason === "terminology"
      ? `No PubMed results for that exact phrase, but the underlying topic is studied. `
      : "";

  const oneLiner = `${prefix}Across ${studies} PubMed studies, ${verdictClause}.`;

  await saveGeneratedTrend({
    data: {
      slug, query, name: finalName, category, verdict: verdict.toLowerCase() as "backed" | "mixed" | "debunked",
      summary: oneLiner, studyCount: studies, confidence, updated,
      evidencePoints: bullets.map((b) => b.text), sentiment, opinions: quotes,
      sourceUrls: articles.slice(0, 6).map((a) => a.url),
    },
  });

  return {
    query, name: finalName, slug, category, verdict, confidence, oneLiner, studies,
    sentiment, updated,
    bullets, quotes, articles: articles.slice(0, 6),
    pubmedSearchUrl, redditSearchUrl, generatedAt,
    ingredientFallback: fallback ? fallback.terms : null,
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

    const pharma = await checkIsPharmaceutical(query);
    if (pharma.isMedicine) {
      // Intentionally not saved to Supabase — pharma queries shouldn't count
      // toward "trends verified" or ever surface as a card anywhere.
      return {
        query, name, slug, category: guessCategoryFallback(query), verdict: "PHARMA", confidence: "low",
        oneLiner: `Veda doesn't cover pharmaceutical medicines like ${pharma.name ?? name} — we focus on supplements, wellness practices, and cosmetic ingredients. For questions about medications, talk to a doctor or pharmacist.`,
        studies: 0, sentiment: 0, updated,
        bullets: [], quotes: [], articles: [],
        pubmedSearchUrl, redditSearchUrl, generatedAt, ingredientFallback: null,
      };
    }

    try {
      const esearch = await fetch(
        `${EUTILS}/esearch.fcgi?db=pubmed&retmode=json&retmax=8&sort=relevance&term=${encodeURIComponent(query)}`,
      );
      if (!esearch.ok) return empty("Couldn't reach PubMed right now. Try again in a moment.");

      const sj = (await esearch.json()) as { esearchresult?: { idlist?: string[] } };
      const ids = sj.esearchresult?.idlist ?? [];

      if (ids.length === 0) {
        // Zero direct hits usually means either (a) a branded product PubMed
        // won't index by name, or (b) colloquial phrasing that doesn't match
        // academic vocabulary for a topic that IS studied. Try alternate
        // search terms before giving up.
        const fallback = await identifyFallbackTerms(query);

        if (fallback) {
          const fallbackTerm = fallback.terms.join(" OR ");
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
                fallback,
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
        pubmedSearchUrl, redditSearchUrl, fallback: null,
      });
    } catch {
      return empty("Couldn't reach PubMed right now. Try again in a moment.");
    }
  });
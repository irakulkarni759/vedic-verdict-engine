import { createServerFn } from "@tanstack/react-start";
import {
  CATEGORY_SLUGS,
  guessCategoryFallback,
  saveGeneratedTrend,
  slugify,
} from "./generatedTrends.functions";
import { toTitleCase, coreSubjectForReddit } from "./utils";
import { fetchRedditQuotesFast, type RedditQuote } from "./reddit.server";

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
  communityVerdict: string;
  safetyNote: string;
  studies: number;
  sentiment: number;
  updated: string;
  bullets: EvidenceBullet[];
  quotes: RedditQuote[];
  articles: EvidenceArticle[];
  pubmedSearchUrl: string;
  redditSearchUrl: string;
  generatedAt: string;
  /** Set when the direct query had zero PubMed hits and we fell back to
   *  searching its likely active ingredients instead (e.g. a branded product). */
  ingredientFallback: string[] | null;
};

const EUTILS = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";

// An NCBI API key raises the eutils rate limit from 3 to 10 requests/sec and
// makes the limit per-key instead of per-IP. That matters here because
// requests go out from Cloudflare's shared egress IPs, so without a key a
// burst of searches easily trips NCBI's per-IP throttle and users see
// "Couldn't reach PubMed". The key is free from NCBI; set NCBI_API_KEY (or
// PUBMED_API_KEY) in the environment to use it. Falls back to keyless.
const NCBI_API_KEY = process.env.NCBI_API_KEY ?? process.env.PUBMED_API_KEY ?? "";

/** Build a eutils URL, appending the API key when one is configured. */
function eutils(path: string): string {
  const sep = path.includes("?") ? "&" : "?";
  return NCBI_API_KEY ? `${EUTILS}/${path}${sep}api_key=${NCBI_API_KEY}` : `${EUTILS}/${path}`;
}

/**
 * Fetch a PubMed eutils endpoint, retrying transient failures (network
 * errors, 429 rate limits, and 5xx) with a short backoff. A single blip or
 * a momentary rate-limit used to dead-end the whole page with "Couldn't
 * reach PubMed"; most of those would have succeeded on a second try.
 * Returns null only after exhausting retries. Genuine 4xx (other than 429)
 * are returned as-is rather than retried.
 */
async function fetchPubmed(path: string, retries = 2): Promise<Response | null> {
  const url = eutils(path);
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url);
      if (res.ok) return res;
      if (res.status !== 429 && res.status < 500) return res;
    } catch {
      // network error; fall through to the backoff + retry below
    }
    if (attempt < retries) {
      await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
    }
  }
  return null;
}

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

/**
 * Some outcomes should always land in a specific category no matter what
 * ingredient/product is attached to the query or what Claude classifies it
 * as — mirrors the same "stress" keyword guessCategoryFallback already uses,
 * but applied as an override ON TOP of Claude's own pick (not just as a
 * fallback for when Claude is unavailable), since Claude's classification
 * keeps following the ingredient's usual bucket (e.g. "supplements" for
 * saffron) instead of the purpose the query is actually about.
 */
function applyOutcomeCategoryOverride(query: string, category: string): string {
  const q = query.toLowerCase();
  if (/stress|anxiety|adaptogen|cortisol|calming|relaxation/.test(q)) return "mental-wellness";
  return category;
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

const PUBMED_STOPWORDS = new Set([
  "for", "the", "a", "an", "and", "or", "with", "to", "of", "in", "on",
  "is", "are", "does", "do", "vs", "how", "what", "best", "good", "help",
  "my", "your", "it", "that", "this",
]);

function extractQueryKeywords(query: string): string[] {
  return query
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.replace(/[^\w]/g, ""))
    .filter((w) => w.length > 2 && !PUBMED_STOPWORDS.has(w));
}

/** Loose singular/plural match: "vacuums" should count a title containing
 *  "vacuum" as a hit, and vice versa, without a full stemmer. */
function keywordInTitle(keyword: string, title: string): boolean {
  if (title.includes(keyword)) return true;
  if (keyword.endsWith("s") && title.includes(keyword.slice(0, -1))) return true;
  if (!keyword.endsWith("s") && title.includes(`${keyword}s`)) return true;
  return false;
}

/**
 * Checks whether the returned PMIDs are actually ABOUT the query's subject,
 * not just a count of hits. PubMed's automatic term mapping can return a
 * full page of results by loosely matching on incidental shared words (e.g.
 * "stomach vacuums for shrinking waist" pulling in generic aerobic-exercise
 * and GLP-1 studies because they mention "waist") while missing on-topic
 * studies that exist under different academic terminology entirely. A
 * plentiful-but-irrelevant result set used to slip past the old
 * count-only WEAK_RESULT_THRESHOLD check and feed bullets straight from
 * off-topic abstracts. Fetches titles via esummary (cheap, one call for
 * all ids) and requires a meaningful share of them to share a keyword with
 * the query's CORE SUBJECT (the purpose clause is stripped first — see the
 * comment inline below for why that part matters). Fails open (true) on any
 * error or when there are no usable keywords, so this never blocks a
 * legitimate result set.
 */
async function checkPubmedRelevance(ids: string[], query: string): Promise<boolean> {
  if (ids.length === 0) return false;
  // Keywords come from the CORE SUBJECT only (purpose clause stripped) —
  // using the full query let generic "waist"/"shrinking" keywords count a
  // hit for any obesity-adjacent study, which is exactly the false-positive
  // that let a page of irrelevant aerobic-exercise/GLP-1 studies through
  // for "stomach vacuums for shrinking waist" even with this check in place.
  const keywords = extractQueryKeywords(coreSubjectForReddit(query));
  if (keywords.length === 0) return true;

  try {
    const res = await fetchPubmed(`esummary.fcgi?db=pubmed&retmode=json&id=${ids.join(",")}`);
    if (!res || !res.ok) return true;
    const json = (await res.json()) as { result?: Record<string, { title?: string }> };
    const result = json.result;
    if (!result) return true;

    const titles = ids.map((id) => (result[id]?.title ?? "").toLowerCase());
    const relevantCount = titles.filter((t) => keywords.some((k) => keywordInTitle(k, t))).length;
    return relevantCount / ids.length >= 1 / 3;
  } catch {
    return true;
  }
}

async function generateBulletsAndQuotes(
  query: string,
  originalQuery: string,
  abstracts: { abstract: string; url: string }[],
  redditQuotes: RedditQuote[],
): Promise<{
  displayName: string | null;
  researchVerdict: string | null;
  communityVerdict: string | null;
  safetyNote: string | null;
  bullets: EvidenceBullet[];
  sentiment: number;
  category: string;
  verdict: "BACKED" | "MIXED" | "DEBUNKED" | null;
}> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return {
      displayName: null, researchVerdict: null, communityVerdict: null, safetyNote: null,
      bullets: [], sentiment: 50, category: guessCategoryFallback(query), verdict: null,
    };
  }

  const abstractText = abstracts
    .map((a, i) => `[${i + 1}] (url: ${a.url})\n${a.abstract}`)
    .join("\n\n");

  const redditContext = redditQuotes.length
    ? redditQuotes.map((q) => `${q.handle}: "${q.text}"`).join("\n")
    : "(no real Reddit comments were found for this search — base the community read on typical experience for this category of product/practice instead, and keep it general rather than implying specific quotes exist)";

  const quoteCountNote = redditQuotes.length
    ? `There are exactly ${redditQuotes.length} real Reddit comment(s) provided below. Treat this as enough to synthesize a real, specific communityVerdict from — do NOT use a generic filler like "Limited public discussion online so far" when comments are present, that phrasing is ONLY for when the list below is empty.`
    : `There are zero real Reddit comments provided below — this is the only case where a generic communityVerdict like "Limited public discussion online so far" is appropriate.`;

  const prompt = `You are a health research analyst. Given these PubMed abstracts and real Reddit comments about "${query}", return a JSON object with eight fields:

1. "displayName": a standardized title in the exact form "X for Y", based on the USER'S ORIGINAL SEARCH, which was: "${originalQuery}". X is the thing the user actually searched for, kept in the everyday wording THEY used — if they searched "stomach vacuum", keep "Stomach Vacuum". Do NOT rename it to a clinical/academic term (e.g. do not turn "stomach vacuum" into "Abdominal Drawing-In Maneuver"), even though the abstracts below may use that scientific term for the same thing. Y is the specific outcome or purpose. If "${originalQuery}" already states a purpose, clean it up into this form (title case, no trailing punctuation). If it doesn't state one, infer the single most common/notable purpose people search this for — never leave Y generic like "for Health" or "for Wellness"; be specific (e.g. "for Hair Growth", "for a Smaller Waist"). The abstracts describe the same topic in scientific vocabulary; use them to understand the topic, NOT to rename it away from the user's own words.
2. "verdict": your overall read of the evidence, one of "BACKED" (the bulk of studies support it working/being beneficial), "MIXED" (evidence is genuinely split or inconclusive), or "DEBUNKED" (the bulk of studies contradict it or find no effect). Base this on your actual understanding of what each abstract found, not just keyword counting — e.g. abstracts describing consistent, specific mechanisms and positive outcomes across most studies should read as BACKED even if few use the literal phrase "significant improvement".
3. "researchVerdict": ONE short sentence, max ~90 chars, ONE idea only — write it the way you'd text a friend, not explain a study. Avoid clinical/technical jargon (say "muscle strength" not "phosphocreatine stores"). State only the single most important real-world takeaway. Do NOT stack multiple clauses with commas/dashes/semicolons (e.g. NOT "X shows promise, but effectiveness depends on Y, and data remain limited" — pick the ONE most important point and cut the rest). If a caveat truly matters more than the headline finding, lead with the caveat instead of appending it. Example good: "Works well when injected, but doesn't absorb through skin." Example bad (too dense, don't do this): "Injected PDRN shows promise for scar healing by stimulating tissue regeneration, but effectiveness depends heavily on delivery method—topical application is unlikely to work, and clinical data remain limited."
4. "communityVerdict": ONE short sentence, max ~90 chars, ONE idea only, same plain/texting-a-friend style, synthesizing the REAL Reddit comments provided below — what people actually notice and talk about most. Do not stack multiple clauses together (no "X happens, and Y is unclear, and Z varies" — pick the single most important thing people say). Do not invent a quote or a specific claim that isn't supported by the real comments. ${quoteCountNote}
5. "safetyNote": ONE short sentence, max ~90 chars, ONE idea, on the most common real safety consideration for "${query}" — drug interactions, pregnancy/breastfeeding warnings, allergy risk, or who should check with a doctor first. Plain language, based on general medical knowledge, not just this abstract set. If there's genuinely nothing notable for typical healthy-adult use, return an empty string "" — don't invent a caution that doesn't apply.
6. "bullets": 3-4 key findings from the PUBMED ABSTRACTS ONLY — never from the Reddit comments. Each bullet must specifically evaluate/test/discuss "${query}" ITSELF (the exact ingredient/product/practice), not just the same broader condition or category. E.g. if the query is about a specific compound for treating acne scars, a study about microneedling or lasers for acne scars is NOT a valid bullet even though it's on-topic for "acne scars" generally — it doesn't study the actual compound. Each bullet must have an accurate "index" pointing at which abstract (1-based) it came from. Never summarize, paraphrase, or reference Reddit/community opinion here — that belongs only in "communityVerdict". If FEWER than 3 (or zero) abstracts specifically evaluate "${query}" itself, return that fewer number of bullets — do not pad with abstracts about the broader condition/category just to reach 3-4, and do not borrow from Reddit content. Each bullet: 1 sentence, 50-150 chars, specific with numbers/stats when available.
7. "sentiment": a number 0-100 representing how positive the community sentiment is about "${query}", based on the real Reddit comments below (if any) and the evidence — not invented.
8. "category": the single best-fit category slug for "${query}", chosen ONLY from this exact list: ${CATEGORY_SLUGS.join(", ")}.

Abstracts:
${abstractText}

Real Reddit comments mentioning "${query}":
${redditContext}

Return ONLY this JSON shape, no other text:
{
  "displayName": "Rosemary Oil for Hair Growth",
  "verdict": "BACKED",
  "researchVerdict": "...",
  "communityVerdict": "...",
  "safetyNote": "...",
  "bullets": [{"text": "...", "index": 1}, ...],
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
        max_tokens: 950,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    const json = await res.json() as { content: { text: string }[] };
    const text = json.content?.[0]?.text ?? "{}";
    const parsed = JSON.parse(text.replace(/```json|```/g, "").trim()) as {
      displayName?: string;
      verdict?: string;
      researchVerdict?: string;
      communityVerdict?: string;
      safetyNote?: string;
      bullets: { text: string; index: number }[];
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

    const researchVerdict = typeof parsed.researchVerdict === "string" && parsed.researchVerdict.trim()
      ? parsed.researchVerdict.trim()
      : null;

    const communityVerdict = typeof parsed.communityVerdict === "string" && parsed.communityVerdict.trim()
      ? parsed.communityVerdict.trim()
      : null;

    const safetyNote = typeof parsed.safetyNote === "string" ? parsed.safetyNote.trim() : null;

    return {
      displayName, researchVerdict, communityVerdict, safetyNote,
      bullets, sentiment: parsed.sentiment ?? 50, category, verdict,
    };
  } catch {
    return {
      displayName: null, researchVerdict: null, communityVerdict: null, safetyNote: null,
      bullets: [], sentiment: 50, category: guessCategoryFallback(query), verdict: null,
    };
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

  const prompt = `"${query}" returned few or no results on a direct PubMed search. PubMed only indexes academic literature, so this happens for two common reasons — figure out which one applies, if either:

1. PRODUCT: "${query}" is a specific branded/commercial product. PubMed won't index it by name, but its active ingredients likely are studied.
2. TERMINOLOGY: "${query}" describes a real practice, ingredient, or activity using colloquial/wellness-culture phrasing that doesn't match academic vocabulary (e.g. "cold plunging" → "cold water immersion", "gut health" → "gut microbiota", "de-stressing" → "stress reduction cortisol"). The underlying topic likely does have real research under different search terms.

If neither applies — "${query}" is already phrased in a way that should have matched relevant research, and genuinely doesn't (obscure, novel, or nonsensical) — return "reason": null.

Return ONLY this JSON shape, no other text:
{"reason": "product", "terms": ["centella asiatica", "zinc oxide"]}
or
{"reason": "terminology", "terms": ["cold water immersion", "deliberate cold exposure stress"]}
or
{"reason": null, "terms": []}

"terms" should be 2-4 plain scientific/academic search phrases suitable for a PubMed query — no parentheses or special characters, just plain words/phrases (e.g. "polydeoxyribonucleotide" not "polydeoxyribonucleotide (PDRN)").`;

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

  // Kick the community scrape off NOW so its (slow) latency overlaps the PubMed
  // article fetch + XML parse + abstract classification below, instead of
  // stacking on top of them. It's awaited just before Claude writes the summary
  // (which needs the quotes), so by then it's had a head start and usually the
  // real quotes are already in hand. .catch keeps a scrape failure from taking
  // down the whole verdict — it just degrades to no quotes for this search.
  const quotesPromise = fetchRedditQuotesFast(coreSubjectForReddit(query)).catch(
    () => [] as RedditQuote[],
  );

  const efetch = await fetchPubmed(`efetch.fcgi?db=pubmed&retmode=xml&id=${ids.join(",")}`);
  const xml = efetch ? await efetch.text() : "";
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

  // NOTE: searchSubject (fallback academic terms when present) is right for
  // PubMed, but wrong for Reddit — people write "PDRN" or "vibration plate,"
  // not "polydeoxyribonucleotide" or "whole body vibration training." Reddit
  // search uses the original colloquial query; PubMed/Claude context below
  // still uses searchSubject.
  const searchSubject = fallback ? fallback.terms.join(" ") : query;

  // The community scrape was kicked off at the top of this function so it could
  // run while PubMed was being fetched and parsed; collect it now. Claude then
  // cleans/picks the quotes and reads sentiment from them in generateBulletsAndQuotes,
  // so the quotes and the summary derived from them are produced together.
  const redditQuotes: RedditQuote[] = await quotesPromise;

  const { displayName, researchVerdict, communityVerdict, safetyNote, bullets, sentiment, category: claudeCategory, verdict: claudeVerdict } =
    await generateBulletsAndQuotes(searchSubject, query, abstractsForClaude, redditQuotes);

  // Claude's own category pick (inside generateBulletsAndQuotes) tends to
  // follow the INGREDIENT's usual bucket rather than the OUTCOME being
  // tested — e.g. "Saffron for Stress" keeps landing in "supplements"
  // because saffron is a supplement, even though the actual purpose is
  // squarely mental-wellness. This runs after Claude's classification and
  // overrides it whenever the query's outcome keywords say otherwise, so
  // it wins regardless of what ingredient/product is attached to it.
  const category = applyOutcomeCategoryOverride(query, claudeCategory);

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

  // researchVerdict is Claude's actual analytical take on the evidence — far
  // more specific/useful than this templated fallback, which only kicks in
  // when Claude's unavailable or didn't return a usable sentence.
  const templatedOneLiner = `${prefix}Across ${studies} PubMed studies, ${verdictClause}.`;
  const oneLiner = researchVerdict ?? templatedOneLiner;

  const isGenericNoDiscussionPhrase = (s: string) =>
    /limited (public )?discussion|not much (public )?discussion|no (real )?discussion/i.test(s);

  const communitySummary =
    communityVerdict && !(redditQuotes.length > 0 && isGenericNoDiscussionPhrase(communityVerdict))
      ? communityVerdict
      : `Community sentiment sits at ${sentiment}% positive based on available discussion.`;

  const finalSafetyNote = safetyNote ?? "";

  await saveGeneratedTrend({
    data: {
      slug, query, name: finalName, category, verdict: verdict.toLowerCase() as "backed" | "mixed" | "debunked",
      summary: oneLiner, communityVerdict: communitySummary, safetyNote: finalSafetyNote, studyCount: studies, confidence, updated,
      evidencePoints: bullets.map((b) => b.text), sentiment, opinions: redditQuotes,
      sourceUrls: articles.slice(0, 6).map((a) => a.url),
    },
  });

  return {
    query, name: finalName, slug, category, verdict, confidence, oneLiner, communityVerdict: communitySummary,
    safetyNote: finalSafetyNote, studies,
    sentiment, updated,
    bullets, quotes: redditQuotes, articles: articles.slice(0, 6),
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
      oneLiner: msg, communityVerdict: "", safetyNote: "", studies: 0, sentiment: 0, updated,
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
        communityVerdict: "", safetyNote: "", studies: 0, sentiment: 0, updated,
        bullets: [], quotes: [], articles: [],
        pubmedSearchUrl, redditSearchUrl, generatedAt, ingredientFallback: null,
      };
    }

    try {
      const esearch = await fetchPubmed(
        `esearch.fcgi?db=pubmed&retmode=json&retmax=15&sort=relevance&term=${encodeURIComponent(query)}`,
      );
      if (!esearch || !esearch.ok) return empty("Couldn't reach PubMed right now. Try again in a moment.");

      const sj = (await esearch.json()) as { esearchresult?: { idlist?: string[] } };
      const ids = sj.esearchresult?.idlist ?? [];

      // Trigger on WEAK results (too few) OR IRRELEVANT results (plenty of
      // hits, but not actually about the query's subject) — a query can
      // return a full page of loosely-related hits (matching on incidental
      // keywords) while missing the actually-relevant research, which sits
      // under different academic terminology. e.g. "vibration plate for
      // weight loss" returned a few bone-density/neuromuscular studies via
      // literal keyword match, while the real weight-loss-specific research
      // lives under "whole body vibration" + body composition terminology.
      // "stomach vacuums for shrinking waist" is the irrelevant-but-plentiful
      // case: 15/15 hits matched on "waist"/"shrinking" alone (GLP-1,
      // generic aerobic exercise) while missing the real research under
      // "abdominal drawing-in maneuver" / "abdominal hollowing" terminology.
      const WEAK_RESULT_THRESHOLD = 5;
      const isWeakCount = ids.length < WEAK_RESULT_THRESHOLD;
      const isIrrelevant = !isWeakCount && !(await checkPubmedRelevance(ids, query));
      if (isWeakCount || isIrrelevant) {
        const fallback = await identifyFallbackTerms(query);

        if (fallback) {
          // Strip parens/quotes — Entrez query syntax uses parens for
          // grouping, so a raw term like "polydeoxyribonucleotide (PDRN)"
          // sends an unbalanced paren that breaks/dilutes the query.
          //
          // Deliberately NOT wrapping terms in quotes for exact-phrase
          // matching — that's too strict for multi-word academic phrases
          // (a real paper's exact wording rarely matches a generated phrase
          // word-for-word) and caused genuinely relevant terms like "Carum
          // copticum digestive effects" to return zero results even though
          // real papers on Carum copticum/ajwain exist. Unquoted terms let
          // PubMed's own automatic term mapping do its job.
          const fallbackTerm = fallback.terms
            .map((t) => t.replace(/[()"]/g, "").trim())
            .filter(Boolean)
            .join(" OR ");
          const fallbackSearch = await fetchPubmed(
            `esearch.fcgi?db=pubmed&retmode=json&retmax=15&sort=relevance&term=${encodeURIComponent(fallbackTerm)}`,
          );

          if (fallbackSearch && fallbackSearch.ok) {
            const fsj = (await fallbackSearch.json()) as { esearchresult?: { idlist?: string[] } };
            const fallbackIds = fsj.esearchresult?.idlist ?? [];

            if (fallbackIds.length > 0) {
              // Fallback ids first — they're matched on the correct academic
              // terminology, so they must not get crowded out by the cap
              // when the original set is already a full page (15) of
              // loosely-matched hits, which is exactly the case that made
              // this an "irrelevant" trigger in the first place.
              const mergedIds = Array.from(new Set([...fallbackIds, ...ids])).slice(0, 15);
              return await buildResultFromIds({
                ids: mergedIds,
                query, name, slug, updated, generatedAt,
                pubmedSearchUrl: `https://pubmed.ncbi.nlm.nih.gov/?term=${encodeURIComponent(fallbackTerm)}`,
                redditSearchUrl,
                fallback,
              });
            }
          }
        }

        if (ids.length > 0) {
          // Fallback search found nothing better — the original (weak but
          // non-empty) results are still the best we have, use them.
          return await buildResultFromIds({
            ids, query, name, slug, updated, generatedAt,
            pubmedSearchUrl, redditSearchUrl, fallback: null,
          });
        }

        const result = { ...empty("No PubMed results — this one isn't well-studied yet."), verdict: "UNKNOWN" as const };
        // Still record the attempt, so it counts toward "trends searched" — but
        // as "unmapped" so it never renders as a real verdict card anywhere.
        await saveGeneratedTrend({
          data: {
            slug, query, name, category: result.category, verdict: "unmapped",
            summary: result.oneLiner, communityVerdict: "", safetyNote: "", studyCount: 0, confidence: "low", updated,
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
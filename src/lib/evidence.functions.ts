import { createServerFn } from "@tanstack/react-start";
import {
  CATEGORY_SLUGS,
  guessCategoryFallback,
  saveGeneratedTrend,
  getGeneratedEvidenceBySlug,
  slugify,
} from "./generatedTrends.functions";
import { toTitleCase, coreSubjectForReddit, outcomeClause, trimGistFragment } from "./utils";
import { fetchCommunityFast, type RedditQuote, type CommunityResult } from "./reddit.server";
import { checkAdminPassword } from "./comments.functions";
import { getSupabaseServiceClient } from "./supabase.server";

export type EvidenceArticle = {
  pmid: string;
  title: string;
  journal: string;
  year: string;
  url: string;
};

export type EvidenceBullet = {
  /** Plain-English headline — what the card shows at first glance. */
  text: string;
  /** Fuller, more technical version of the same finding — mechanism,
   *  stats, clinical terms — shown only once the card is clicked open. */
  detail: string;
  /** e.g. "Randomized controlled trial", "Animal study", "Observational
   *  study", "Meta-analysis", "In vitro study" — shown on the card itself. */
  studyType: string;
  /** A real caveat worth knowing at a glance, e.g. "Animal study — may not
   *  apply to humans", "Small sample (n=12)", "No control group". Empty
   *  string when the abstract doesn't surface a notable limitation. */
  limitations: string;
  url: string;
  /** True for a bullet built from a single KEY INGREDIENT's own PubMed
   *  search (buildIngredientBullets) rather than the product/query's own
   *  search — the UI badges these distinctly so it's clear the finding is
   *  about one ingredient in isolation, not the product/outcome itself. */
  isIngredient?: boolean;
};

export type IngredientEvidence = {
  ingredient: string;
  verdict: "BACKED" | "MIXED" | "DEBUNKED" | "UNKNOWN";
  oneLiner: string;
  studies: number;
  pubmedSearchUrl: string;
  /** Same concept as EvidenceBullet.studyType/limitations, added later than
   *  the rest of this type so older code paths default it to "" — empty
   *  string here means "not available" (e.g. UNKNOWN-verdict ingredients
   *  with zero studies), not "no notable limitation" like on a real bullet. */
  studyType: string;
  limitations: string;
};

export type EvidenceVerdict = {
  query: string;
  name: string;
  slug: string;
  category: string;
  verdict: "BACKED" | "MIXED" | "DEBUNKED" | "UNKNOWN" | "PHARMA";
  confidence: "high" | "moderate" | "low";
  oneLiner: string;
  /** 2-4 skimmable fragments (2-3 words each, e.g. "Reduces fine lines",
   *  "Takes 8+ weeks") for the hero's bulleted research summary. Empty
   *  when Claude didn't return usable gist phrases — callers should fall
   *  back to showing oneLiner as a single bullet in that case. */
  researchGist: string[];
  communityVerdict: string;
  /** Same idea as researchGist, but for community sentiment. */
  communityGist: string[];
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
  /** Only set for branded-product queries (ingredientFallback.reason === "product"
   *  under the hood) — a per-ingredient verdict/explanation, so "Chanel Lotion"
   *  shows what the research says about EACH of its key ingredients individually,
   *  instead of only one blended verdict for the whole product. */
  ingredientBreakdown: IngredientEvidence[] | null;
  /** Where the ingredient list itself came from. verified=true means it was
   *  actually found via a live web search of the product's real page
   *  (sourceUrl points at it); verified=false means no real source was
   *  found and this falls back to Claude's best estimate — surfaced
   *  honestly in the UI rather than presented as a confirmed formulation. */
  ingredientSource: { url: string | null; verified: boolean } | null;
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
  researchGist: string[];
  communityVerdict: string | null;
  communityGist: string[];
  safetyNote: string | null;
  bullets: EvidenceBullet[];
  sentiment: number;
  category: string;
  verdict: "BACKED" | "MIXED" | "DEBUNKED" | null;
}> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return {
      displayName: null, researchVerdict: null, researchGist: [], communityVerdict: null, communityGist: [],
      safetyNote: null, bullets: [], sentiment: 50, category: guessCategoryFallback(query), verdict: null,
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
2. "verdict": your overall read of the evidence, one of "BACKED" (the bulk of studies support it working/being beneficial), "MIXED" (evidence is genuinely split, inconclusive, or there's real research on the ingredient but not specifically on this outcome), or "DEBUNKED" (the bulk of studies contradict it or find no effect). Base this ONLY on abstracts that actually address "${query}"'s specific outcome/purpose, not just its general subject — e.g. for "Carrot for Clear Skin", abstracts about carotenoids and UV protection are a different outcome (sun protection, not acne/clear skin) and should NOT be treated as support for this claim even though they're positive findings about carotenoids. If most/all of the abstracts turn out to be about a different outcome than the one in the query, that itself points toward MIXED (real research exists on the ingredient, just not on this specific claim) rather than BACKED. Within on-topic abstracts, base this on your actual understanding of what each found, not just keyword counting — e.g. abstracts describing consistent, specific mechanisms and positive outcomes across most studies should read as BACKED even if few use the literal phrase "significant improvement".
3. "researchVerdict": ONE short sentence, max ~90 chars, ONE idea only — write it so a 12-year-old would understand it immediately, not explain a study. Avoid clinical/technical jargon and any word most people wouldn't casually use out loud (say "muscle strength" not "phosphocreatine stores"). State only the single most important real-world takeaway. Do NOT stack multiple clauses with commas/dashes/semicolons/"but"+"and" combos (e.g. NOT "X shows promise, but effectiveness depends on Y, and data remain limited" — pick the ONE most important point and cut the rest). If a caveat truly matters more than the headline finding, lead with the caveat instead of appending it. Example good: "Works well when injected, but doesn't absorb through skin." Example bad (too dense, don't do this): "Injected PDRN shows promise for scar healing by stimulating tissue regeneration, but effectiveness depends heavily on delivery method—topical application is unlikely to work, and clinical data remain limited."
3b. "researchGist": 2-4 short phrases, EACH 2-3 WORDS MAX (not sentences — fragments, like skimmable tags), capturing the key research findings so someone with zero science background and no patience could skim them in two seconds. Plain, common, everyday words only — no jargon, no full sentences, no verbs-with-subjects if a shorter fragment works. This means no mechanism names, no enzyme/hormone/receptor names, no lab/biological terminology at all — describe the real-world EFFECT, never the mechanism behind it. Say "Slows hair loss" not "Blocks DHT enzyme" (that's also just wrong — DHT is a hormone, not an enzyme; nobody skimming a card needs to know 5-alpha-reductase exists). Say "Reduces redness" not "Anti-inflammatory effects." Think of these as what you'd highlight if you only had 3 words per point, written for a friend with zero science background, not a term from the abstract. Example good: ["Reduces fine lines", "Better elasticity", "Takes 8+ weeks", "Modest effect size"]. Example bad (too long/full-sentence, don't do this): ["Oral collagen peptides consistently improved wrinkle depth", "Effects take several weeks to become noticeable"]. Example bad (mechanism jargon, don't do this): ["Blocks DHT enzyme in lab", "Inhibits 5-alpha-reductase"] — say ["Slows hair loss in lab tests"] instead. Order by importance, most important finding first. Base every phrase on the actual abstracts, never invent one.
4. "communityVerdict": ONE short sentence, max ~90 chars, ONE idea only, same 12-year-old-plain style, synthesizing the REAL Reddit comments provided below — what people actually notice and talk about most. Do NOT stack multiple clauses together with commas/"but"/"and" (e.g. NOT "People report real results, but skeptics note it's animal-derived and debate whether it delivers" — that's three ideas crammed together; pick the SINGLE most important thing people say and cut the rest). Example good: "Most people say it actually works, though results take a few months." Example bad (too dense, don't do this): "People report real results, but skeptics note collagen is animal-derived and debate whether supplements truly deliver what they promise." Do not invent a quote or a specific claim that isn't supported by the real comments. ${quoteCountNote}
4b. "communityGist": 2-4 short phrases, EACH 2-3 WORDS MAX, same skimmable-fragment style as researchGist, capturing what real people actually say in the Reddit comments provided below. Example good: ["Mixed reviews", "Vegan skepticism", "Real results, slow"]. Example bad (too long, don't do this): ["People report real results over time", "Skeptics question if it actually absorbs"]. Order by how often/strongly the community mentions it, most common first. Base every phrase on the real comments below, never invent one. Empty array if there aren't enough real comments to summarize.
5. "safetyNote": ONE short sentence, max ~90 chars, ONE idea, on the most common real safety consideration for "${query}" — drug interactions, pregnancy/breastfeeding warnings, allergy risk, or who should check with a doctor first. Plain language, based on general medical knowledge, not just this abstract set. If there's genuinely nothing notable for typical healthy-adult use, return an empty string "" — don't invent a caution that doesn't apply.
6. "bullets": 3-4 key findings from the PUBMED ABSTRACTS ONLY — never from the Reddit comments. Each bullet must specifically evaluate/test/discuss "${query}" ITSELF (the exact ingredient/product/practice) AND the exact OUTCOME/PURPOSE in the query, not just the same broader condition, category, or a different outcome for the same ingredient. Three distinct ways an abstract can fail this: (a) different intervention, same outcome — e.g. if the query is about a specific compound for treating acne scars, a study about microneedling or lasers for acne scars is NOT a valid bullet even though it's on-topic for "acne scars" generally, it doesn't study the actual compound; (b) right ingredient, wrong outcome — e.g. for "Carrot for Clear Skin", an abstract about carotenoids and UV protection/sun damage is NOT a valid bullet even though carotenoids are the right subject, because UV protection is a different outcome than clear skin/acne; (c) general background with no specific treatment tested — e.g. for "Coconut Cult for Bloating", an abstract that just explains what causes bloating generally, or describes coconut water's electrolyte composition, without actually testing coconut (or Coconut Cult specifically) AGAINST bloating, is not a valid bullet even though both words appear in it — background/definitional content is not evidence. All three count as off-topic. Each bullet must have an accurate "index" pointing at which abstract (1-based) it came from. Never summarize, paraphrase, or reference Reddit/community opinion here — that belongs only in "communityVerdict". If FEWER than 3 (or zero) abstracts specifically evaluate BOTH "${query}"'s subject AND its outcome, return that fewer number of bullets — do not pad with abstracts about the broader condition/category, general background, or a different outcome just to reach 3-4, and do not borrow from Reddit content. Each bullet has FOUR fields:
"text" — the plain-English headline shown at first glance. Write it for someone with NO science background: short words, one idea, one clause if at all possible. No jargon, no mechanism names, no units or dosages unless a normal person would casually say them. Say "helped people fall asleep faster" not "reduced sleep onset latency"; say "reduced redness" not "decreased erythema"; say "worked about as well as a placebo" not "showed no statistically significant difference from control." Prefer everyday comparisons over numbers where it keeps things clear (e.g. "about half the people" over "48.3%"). If the abstract's subject is a long/hard-to-pronounce chemical or INCI name (common with branded-product ingredients, e.g. "Ethylhexylglycerin," "Chlorphenesin," "Carbomer Homopolymer Type B") — do NOT lead the sentence with that name as the subject. Either describe it by its plain-language role instead ("This preservative..." / "A common thickening agent...") or, if naming it really matters, pair it with a short plain clarifier the first time ("Ethylhexylglycerin, a preservative, ..."). Say "A common preservative helps stop bacteria growth" not "Ethylhexylglycerin stops growth of common skin bacteria" — nobody skimming a card wants to parse a chemical name to find out what it does. 1 short sentence, aim for under 100 characters, hard cap 150.
"detail" — the fuller, technical version of that exact same finding, shown only once someone clicks for more — include the actual mechanism, specific stats/dosage/sample size/effect size from the abstract when available, clinical terminology is fine here, 1-2 sentences, up to ~280 chars.
"studyType" — the kind of study this abstract describes, in plain terms: "Randomized controlled trial", "Animal study", "Observational study", "Meta-analysis", "In vitro study" (i.e. a lab/petri-dish study, not living subjects), "Case report", "Review", or "Small pilot study". Infer this from the abstract's methodology, don't guess if truly unclear — use "Study" as a last resort.
"limitations" — ONE short, genuinely useful caveat a normal person would want to know before trusting this finding — but ONLY for a study that DOES pass the relevance bar above and has a real methodological weakness (small sample, animal-only, no control group, short duration, industry-funded, self-reported). Do NOT use this field to admit a study doesn't actually evaluate the claim ("this abstract describes the condition generally," "does not test any treatment," "does not specifically address X") — that's not a limitation, that's the abstract failing rule 6's relevance bar entirely, and the fix is to EXCLUDE that bullet, never to include it with a caveat explaining why it doesn't belong. If you find yourself writing a limitations sentence that amounts to "doesn't actually test/evaluate/address this," stop and drop the bullet instead. Empty string "" if a relevant abstract doesn't have a notable limitation — never invent one just to fill the field.
Never invent a number, study type, or limitation that isn't actually supported by the abstract.
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
  "researchGist": ["...", "...", "..."],
  "communityVerdict": "...",
  "communityGist": ["...", "...", "..."],
  "safetyNote": "...",
  "bullets": [{"text": "...", "detail": "...", "studyType": "...", "limitations": "...", "index": 1}, ...],
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
      researchGist?: string[];
      communityVerdict?: string;
      communityGist?: string[];
      safetyNote?: string;
      bullets: { text: string; detail?: string; studyType?: string; limitations?: string; index: number }[];
      sentiment: number;
      category?: string;
    };

    const bullets = (parsed.bullets ?? []).map((item) => ({
      text: item.text,
      // Fall back to the plain text if Claude ever omits detail, so the
      // click-to-expand never reveals a blank/undefined card.
      detail: typeof item.detail === "string" && item.detail.trim() ? item.detail.trim() : item.text,
      studyType: typeof item.studyType === "string" && item.studyType.trim() ? item.studyType.trim() : "Study",
      limitations: typeof item.limitations === "string" ? item.limitations.trim() : "",
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

    // Trim + drop empties; also cap length so a stray full-sentence gist
    // (model didn't follow the 2-3 word instruction) doesn't blow up the
    // skimmable-bullet layout. Word-boundary cap — the old hard slice
    // visibly chopped words in half ("...builds muscle with resistan").
    const cleanGist = (arr: string[] | undefined): string[] =>
      (arr ?? [])
        .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
        .map((s) => trimGistFragment(s))
        .slice(0, 4);

    const researchGist = cleanGist(parsed.researchGist);
    const communityGist = cleanGist(parsed.communityGist);

    const safetyNote = typeof parsed.safetyNote === "string" ? parsed.safetyNote.trim() : null;

    return {
      displayName, researchVerdict, researchGist, communityVerdict, communityGist, safetyNote,
      bullets, sentiment: parsed.sentiment ?? 50, category, verdict,
    };
  } catch {
    return {
      displayName: null, researchVerdict: null, researchGist: [], communityVerdict: null, communityGist: [],
      safetyNote: null, bullets: [], sentiment: 50, category: guessCategoryFallback(query), verdict: null,
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

1. PRODUCT: "${query}" is a specific branded/commercial product. PubMed won't index it by name, but its active ingredients likely are studied. IMPORTANT: for this case, "terms" get shown directly to the user as "Key ingredients: ..." — each one MUST be a clean, standalone ingredient/compound name only (e.g. "carnosic acid", "rosemary extract", "biotin"), never combined with the condition/outcome it's being searched for. WRONG: "Rosemary Hair Growth", "Carnosic Acid Hair Follicle", "Rosmarinus Officinalis Androgenetic Alopecia" — these read as garbled nonsense to a person even though they're fine as PubMed search phrases. RIGHT for the same ingredients: "rosemary extract", "carnosic acid", "rosmarinus officinalis". If you can't identify real plausible ingredient names for this product, return reason: null rather than inventing garbled compound phrases just to have something to show.
2. TERMINOLOGY: "${query}" describes a real practice, ingredient, or activity using colloquial/wellness-culture phrasing that doesn't match academic vocabulary (e.g. "cold plunging" → "cold water immersion", "gut health" → "gut microbiota", "de-stressing" → "stress reduction cortisol"). The underlying topic likely does have real research under different search terms. These terms are ONLY used for searching (never shown to the user as a list), so combining a subject with its outcome here (e.g. "carotenoids skin health") is fine.

If "${query}" names a specific OUTCOME/PURPOSE (an "X for Y" structure, or one implied), the translated terms MUST keep targeting that SAME outcome — never broaden into the ingredient's general research area just because that's where the studies actually exist. E.g. "Carrot for Clear Skin" is about acne/blemishes/complexion specifically — terms like "carotenoids skin health" or "beta-carotene photoprotection" are WRONG even though carotenoids are genuinely well-studied, because that research is about UV protection and antioxidant effects, a different outcome entirely, not clear skin/acne. The correct move there is terms that keep the acne/complexion angle (e.g. "beta-carotene acne", "carotenoids sebum") if that research exists, or reason: null if it doesn't — never quietly substitute a different outcome just because it's better-studied.

If neither applies — "${query}" is already phrased in a way that should have matched relevant research, and genuinely doesn't (obscure, novel, or nonsensical) — return "reason": null.

Return ONLY this JSON shape, no other text:
{"reason": "product", "terms": ["centella asiatica", "zinc oxide"]}
or
{"reason": "terminology", "terms": ["cold water immersion", "deliberate cold exposure stress"]}
or
{"reason": null, "terms": []}

"terms" should be 2-4 plain scientific/academic terms — no parentheses or special characters, just plain words/phrases (e.g. "polydeoxyribonucleotide" not "polydeoxyribonucleotide (PDRN)"). For "product", each term is a standalone ingredient name only (see above). For "terminology", each term is a search phrase for the underlying topic.`;

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
  } catch (e) {
    console.error("[identifyFallbackTerms] failed for", JSON.stringify(query), ":", e);
    return null;
  }
}

/**
 * For branded products (identifyFallbackTerms already flagged "product"),
 * this actually searches the web for the product's REAL, official
 * ingredient list — the brand's own site first, then reputable retailers
 * (Sephora, Ulta, Amazon) or INCIDecoder — instead of relying on Claude's
 * training-data guess of "products like this typically contain X." Uses
 * the Anthropic web_search server tool, so the model is reading an actual
 * live page, not recalling one from memory.
 *
 * Returns null if no API key, the search comes back empty, or nothing
 * matching this specific product's real ingredient list was found —
 * callers should fall back to identifyFallbackTerms's guess in that case,
 * clearly labeled as an estimate rather than a verified list.
 */
async function findRealIngredients(query: string): Promise<{
  productName: string;
  sourceUrl: string | null;
  allIngredients: string[];
  keyIngredients: string[];
} | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  const prompt = `Search the web for the REAL, official ingredient list (INCI list) of the specific product "${query}". Be persistent — try multiple search angles before giving up, this matters more than speed:

1. First, find the brand's own official website (search "[brand name] official website" if it's not obvious) and check the product's own page there — smaller and international/regional brands especially (not just US/Sephora-style ones) very often ONLY list full ingredients on their own site, nowhere else. Don't skip this step just because the brand isn't a major one you already recognize.
2. If the brand site doesn't have it, check reputable retailers that carry the product (this varies a lot by brand and region — Sephora/Ulta/Amazon for many US brands, but could be Nykaa, iHerb, or any other retailer that actually stocks this specific product) or an ingredient-lookup site like INCIDecoder.
3. If a first search doesn't surface it, try a differently-worded search (e.g. the brand name plus "ingredients," or plus "INCI," or just the brand's likely domain directly) before concluding it can't be found.

Do NOT guess or rely on general knowledge of what products like this "typically" contain — only use an ingredient list you actually find on a real page for this exact product.

Once you find it (or determine you can't), return ONLY this JSON, no other text before or after it:
{"found": true, "productName": "...", "sourceUrl": "https://...", "allIngredients": ["...", "..."], "keyIngredients": ["...", "..."]}

"allIngredients": the full list exactly as shown on the source, in the same order.
"keyIngredients": from that SAME real list, the 3-5 most notable/active ingredients actually worth researching for efficacy (skip plain water, generic fragrance, and standard preservatives/thickeners unless one of those IS the ingredient being marketed).

If you search and cannot find a real, verifiable ingredient list for this exact product (can't find the product, discontinued, no retailer lists ingredients for it), return exactly: {"found": false}`;

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 3000,
        messages: [{ role: "user", content: prompt }],
        tools: [{ type: "web_search_20250305", name: "web_search" }],
      }),
    });

    const json = (await res.json()) as { content?: { type: string; text?: string }[] };
    // A web-search turn's response mixes text blocks with server_tool_use /
    // web_search_tool_result blocks — only the text blocks carry Claude's
    // actual written answer, which is where the JSON lives.
    const text = (json.content ?? [])
      .filter((b) => b.type === "text")
      .map((b) => b.text ?? "")
      .join("\n")
      .trim();

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    const parsed = JSON.parse(jsonMatch[0]) as {
      found?: boolean;
      productName?: string;
      sourceUrl?: string;
      allIngredients?: string[];
      keyIngredients?: string[];
    };

    if (!parsed.found) return null;
    const keyIngredients = (parsed.keyIngredients ?? []).filter(Boolean).slice(0, 5);
    if (keyIngredients.length === 0) return null;

    return {
      productName: typeof parsed.productName === "string" && parsed.productName.trim() ? parsed.productName.trim() : query,
      sourceUrl: typeof parsed.sourceUrl === "string" && parsed.sourceUrl.trim() ? parsed.sourceUrl.trim() : null,
      allIngredients: (parsed.allIngredients ?? []).filter(Boolean).slice(0, 40),
      keyIngredients,
    };
  } catch (e) {
    console.error("[findRealIngredients] failed for", JSON.stringify(query), ":", e);
    return null;
  }
}


/**
 * Real ingredient names (from a verified source) usually already arrive
 * correctly formatted — acronyms like "PEG-40" or "BHT", parenthetical
 * notes like "Aqua (Water)". Running that through toTitleCase (which
 * lowercases everything first, then capitalizes only the first letter of
 * each whitespace-separated word) destroys exactly that formatting:
 * "PEG-40" becomes "Peg-40", "Aqua (Water)" becomes "Aqua (water)" since
 * nothing after an opening parenthesis gets touched. Only apply toTitleCase
 * to names that look like they actually need it — i.e. arrived essentially
 * all lowercase, the way Claude's own guesses tend to — otherwise trust the
 * source's own casing as-is.
 */
function formatIngredientName(raw: string): string {
  const trimmed = raw.trim();
  return /[A-Z]/.test(trimmed) ? trimmed : toTitleCase(trimmed);
}

/**
 * Small, focused PubMed lookup for a single ingredient — used by
 * buildIngredientBreakdown, deliberately separate from buildResultFromIds
 * (which does a lot more: Reddit, saving to Supabase, full verdict/bullets).
 * retmax is intentionally small (6) since this runs once per ingredient
 * (up to 4 in parallel) and only needs enough abstracts for a one-line
 * per-ingredient verdict, not a full evidence card.
 */
async function fetchAbstractsForIngredient(
  term: string,
): Promise<{ studies: number; abstracts: { abstract: string; url: string }[] }> {
  try {
    const esearch = await fetchPubmed(
      `esearch.fcgi?db=pubmed&retmode=json&retmax=6&sort=relevance&term=${encodeURIComponent(term)}`,
    );
    if (!esearch || !esearch.ok) return { studies: 0, abstracts: [] };
    const sj = (await esearch.json()) as { esearchresult?: { idlist?: string[] } };
    const ids = sj.esearchresult?.idlist ?? [];
    if (ids.length === 0) return { studies: 0, abstracts: [] };

    const efetch = await fetchPubmed(`efetch.fcgi?db=pubmed&retmode=xml&id=${ids.join(",")}`);
    const xml = efetch ? await efetch.text() : "";
    const blocks = xml.split(/<PubmedArticle[>\s]/).slice(1);

    const abstracts: { abstract: string; url: string }[] = [];
    for (const raw of blocks) {
      const block = decodeEntities(raw);
      const pmid = pickTag(block, "PMID") ?? "";
      const abstract = pickAll(block, "AbstractText").join(" ");
      if (pmid && abstract) {
        abstracts.push({ abstract: abstract.slice(0, 600), url: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/` });
      }
    }
    return { studies: ids.length, abstracts: abstracts.slice(0, 4) };
  } catch {
    return { studies: 0, abstracts: [] };
  }
}

/**
 * Real ingredient lists carry display-worthy detail — concentrations
 * ("Niacinamide (4%)") and dual INCI/common names joined by a slash
 * ("Butyrospermum Parkii Butter/Shea Butter") — that make terrible literal
 * PubMed search terms. esearch ANDs every token in an unquoted query, so
 * the percentage and the second name are just extra required tokens on
 * top of the outcome anchor, and can zero out results for ingredients
 * that are otherwise heavily studied (shea butter, niacinamide, etc).
 * This strips the percentage and keeps only the last "/"-separated
 * segment (the common name, by INCI-list convention) for SEARCHING ONLY —
 * the original, unmodified ingredient string is still what's displayed.
 */
function pubmedTermForIngredient(ingredient: string): string {
  const withoutPercent = ingredient.replace(/\(\s*[\d.]+\s*%\s*\)/g, " ");
  const segments = withoutPercent.split("/").map((s) => s.trim()).filter(Boolean);
  return (segments[segments.length - 1] || withoutPercent).replace(/\s+/g, " ").trim();
}

/**
 * For a branded product like "Chanel Lotion" — where PubMed has nothing on
 * the product itself but identifyFallbackTerms found its likely key
 * ingredients — this looks up each ingredient SEPARATELY and returns an
 * individual verdict + plain-English explanation per ingredient, instead of
 * only the one blended verdict buildResultFromIds produces from all
 * ingredients' abstracts merged together. That blended verdict still runs
 * and still shows (it's a reasonable "overall" read), this is additive: it
 * answers "well, which specific ingredient is actually backed vs not."
 *
 * One Claude call total (not one per ingredient) — all ingredients' abstracts
 * go in a single prompt and come back as a same-order JSON array, keeping
 * this to the same API cost as the rest of the pipeline. Falls back to the
 * cheap keyword scan (like keywordVerdict elsewhere) if there's no API key
 * or the call fails, so a Claude hiccup never blanks the whole section.
 */
async function buildIngredientBreakdown(
  productName: string,
  ingredients: string[],
  outcome: string | null,
): Promise<IngredientEvidence[]> {
  const capped = ingredients.slice(0, 4);
  const looked = await Promise.all(
    capped.map(async (ingredient) => {
      // Search term stays outcome-anchored ("ursolic acid hair growth"),
      // while `ingredient` (the clean name) is what's actually displayed —
      // searching the bare ingredient name alone pulls in whatever that
      // compound is MOST studied for generally (e.g. ursolic acid's
      // antiparasitic research), which is very often unrelated to the
      // actual product claim. The name fed into the search itself is
      // cleaned of concentration/dual-naming noise first — see
      // pubmedTermForIngredient.
      const cleanIngredient = pubmedTermForIngredient(ingredient);
      const searchTerm = outcome ? `${cleanIngredient} ${outcome}` : cleanIngredient;
      const { studies, abstracts } = await fetchAbstractsForIngredient(searchTerm);
      return {
        ingredient,
        studies,
        abstracts,
        pubmedSearchUrl: `https://pubmed.ncbi.nlm.nih.gov/?term=${encodeURIComponent(searchTerm)}`,
      };
    }),
  );

  const withStudies = looked.filter((r) => r.abstracts.length > 0);
  const withoutStudies = looked.filter((r) => r.abstracts.length === 0);

  const noStudyEntries: IngredientEvidence[] = withoutStudies.map((r) => ({
    ingredient: formatIngredientName(r.ingredient),
    verdict: "UNKNOWN",
    oneLiner: `No PubMed studies found specifically on ${toTitleCase(r.ingredient)}.`,
    studies: r.studies,
    pubmedSearchUrl: r.pubmedSearchUrl,
    studyType: "",
    limitations: "",
  }));

  if (withStudies.length === 0) return noStudyEntries;

  const keywordFallbackEntries = (): IngredientEvidence[] =>
    withStudies.map((r) => {
      let pos = 0, neg = 0, neutral = 0;
      for (const a of r.abstracts) {
        const cls = classifyAbstract(a.abstract);
        if (cls === "pos") pos++;
        else if (cls === "neg") neg++;
        else neutral++;
      }
      const total = pos + neg + neutral || 1;
      let verdict: IngredientEvidence["verdict"] = "MIXED";
      if (pos / total >= 0.55 && pos > neg) verdict = "BACKED";
      else if (neg / total >= 0.45 && neg > pos) verdict = "DEBUNKED";
      const plain =
        verdict === "BACKED" ? "mostly supportive" : verdict === "DEBUNKED" ? "mostly unsupportive" : "mixed";
      return {
        ingredient: formatIngredientName(r.ingredient),
        verdict,
        oneLiner: `Across ${r.studies} PubMed ${r.studies === 1 ? "study" : "studies"}, findings are ${plain}.`,
        studies: r.studies,
        pubmedSearchUrl: r.pubmedSearchUrl,
        studyType: "Study",
        limitations: "",
      };
    });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return [...keywordFallbackEntries(), ...noStudyEntries];

  const prompt = `"${productName}" is a branded product. Below are PubMed abstracts for ${withStudies.length} of its key ingredients. For EACH ingredient, read ONLY its own abstracts (don't mix findings across ingredients) and provide four things:

"oneLiner" — a plain-English, layman verdict, no jargon, 1 short sentence, like you'd explain to a friend (e.g. "Helps with hydration in a few small studies" not "demonstrates humectant properties in RCTs"). If the ingredient name itself is a hard-to-pronounce chemical/INCI name, don't lead with it as the subject — describe its plain-language role instead (e.g. "A common preservative shows no safety concerns" not "Ethylhexylglycerin shows no safety concerns").
"studyType" — the kind of study these abstracts mostly are, in plain terms: "Randomized controlled trial", "Animal study", "Observational study", "Meta-analysis", "In vitro study", "Case report", "Review", or "Small pilot study". Use "Study" as a last resort if truly unclear.
"limitations" — ONE short, genuinely useful caveat about a real methodological weakness (small sample, animal-only, no control group, short duration) — but only for an abstract that actually evaluates this ingredient doing something, not one that's just background/composition information with no outcome tested. Don't use this field to admit the abstract doesn't really test anything; if that's the case, treat it as a "no studies" ingredient instead (studies: 0 territory) rather than writing a limitations sentence explaining the abstract's irrelevance. Empty string "" if nothing specific applies — never invent one.
"verdict" — BACKED if the abstracts mostly support it working, DEBUNKED if they mostly don't, MIXED if split or unclear.

${withStudies
  .map(
    (r, i) =>
      `INGREDIENT ${i + 1}: "${r.ingredient}"\n${r.abstracts
        .map((a, j) => `Abstract ${j + 1}: ${a.abstract}`)
        .join("\n")}`,
  )
  .join("\n\n")}

Return ONLY this JSON array, one entry per ingredient IN THE SAME ORDER given above, no other text:
[{"verdict": "BACKED" | "MIXED" | "DEBUNKED", "oneLiner": "...", "studyType": "...", "limitations": "..."}]

Base all of this only on what's in the abstracts above — never invent a finding, study type, or limitation that isn't there.`;

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
        max_tokens: 700,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    const json = (await res.json()) as { content: { text: string }[] };
    const text = json.content?.[0]?.text ?? "[]";
    const parsed = JSON.parse(text.replace(/```json|```/g, "").trim()) as
      { verdict?: string; oneLiner?: string; studyType?: string; limitations?: string }[];

    const claudeEntries: IngredientEvidence[] = withStudies.map((r, i) => {
      const item = parsed[i];
      const verdict: IngredientEvidence["verdict"] =
        item?.verdict === "BACKED" || item?.verdict === "MIXED" || item?.verdict === "DEBUNKED"
          ? item.verdict
          : "MIXED";
      return {
        ingredient: formatIngredientName(r.ingredient),
        verdict,
        oneLiner:
          typeof item?.oneLiner === "string" && item.oneLiner.trim()
            ? item.oneLiner.trim()
            : `Across ${r.studies} PubMed studies, findings are mixed.`,
        studies: r.studies,
        pubmedSearchUrl: r.pubmedSearchUrl,
        studyType:
          typeof item?.studyType === "string" && item.studyType.trim() ? item.studyType.trim() : "Study",
        limitations: typeof item?.limitations === "string" ? item.limitations.trim() : "",
      };
    });
    return [...claudeEntries, ...noStudyEntries];
  } catch {
    return [...keywordFallbackEntries(), ...noStudyEntries];
  }
}

/**
 * Turns the top 3 key ingredients WITH REAL DATA into separate bullet
 * cards, styled and structured exactly like every other "WHAT THE RESEARCH
 * SAYS" card (number, study type badge, limitations badge, click-to-expand
 * detail) — instead of one folded summary line. Ingredients with zero
 * PubMed hits (verdict "UNKNOWN") are dropped entirely rather than shown as
 * an empty "NO DATA" card — a card with nothing on it isn't evidence, it's
 * just noise padding out the section. They still count toward the overall
 * studies banner via ingredientStudyTotal (see caller). Ingredients beyond
 * the top 3 (with data) still count toward that banner but don't get their
 * own card, to keep the section from ballooning for a single product.
 */
function buildIngredientBullets(
  ingredientBreakdown: IngredientEvidence[],
  ingredientSource: EvidenceVerdict["ingredientSource"],
): EvidenceBullet[] {
  return ingredientBreakdown
    .filter((ing) => ing.verdict !== "UNKNOWN")
    .slice(0, 3)
    .map((ing, i) => {
      const sourceCaveat = !ingredientSource?.verified && i === 0
        ? "Estimated ingredient list — not a confirmed formulation"
        : "";
      const limitations = [sourceCaveat, ing.limitations].filter(Boolean).join("; ");

      return {
        text: `${ing.ingredient} — ${ing.oneLiner}`,
        detail: `Based on ${ing.studies} PubMed ${ing.studies === 1 ? "study" : "studies"} specifically on ${ing.ingredient}. ${ing.oneLiner}`,
        studyType: ing.studyType || "Study",
        limitations,
        url: ing.pubmedSearchUrl,
        isIngredient: true,
      };
    });
}


type QueryClassification = {
  /** The query with obvious typos fixed (especially brand/ingredient names,
   *  e.g. "the ordinaty" -> "the ordinary") — the rest of the pipeline runs
   *  on this. Identical to the raw query when nothing needed fixing. */
  correctedQuery: string;
  isProduct: boolean;
  isMedicine: boolean;
  medicineName: string | null;
  /** For product queries with no explicit "for Y" clause: the single main
   *  outcome people buy this product for ("acne", "hair growth"), used to
   *  anchor the per-ingredient PubMed searches so they don't drift into
   *  whatever each compound is most-studied for generally. Null otherwise. */
  impliedOutcome: string | null;
};

/**
 * ONE early Haiku call that answers everything the pipeline needs to know
 * about the query before searching — replaces what used to be two separate
 * serial calls (checkIsPharmaceutical, checkIsBrandedProduct) and adds typo
 * correction, so a misspelled brand name ("the ordinaty niacinamide") stops
 * dead-ending at "No PubMed results" when the intended product is obvious.
 *
 * This one call gates the entire pipeline — a transient failure (rate
 * limit, network blip) silently defaulting to "not a product / no fix"
 * means an obviously-branded or obviously-misspelled query produces an
 * essentially empty page with no error anywhere. Retries once, logs both
 * failures, and fails open to "use the query as typed."
 */
async function classifyQuery(query: string): Promise<QueryClassification> {
  const failOpen: QueryClassification = {
    correctedQuery: query, isProduct: false, isMedicine: false, medicineName: null, impliedOutcome: null,
  };
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return failOpen;

  const prompt = `A user searched a wellness fact-checking site for: "${query}"

Answer FOUR things about this query, as one JSON object:

1. "corrected_query": the query with obvious spelling/typo mistakes fixed — especially misspelled brand names, product names, and ingredient names (e.g. "the ordinaty niacinamide" -> "the ordinary niacinamide", "ashwaganda" -> "ashwagandha", "rosemarry oil" -> "rosemary oil"). Fix ONLY clear typos; never rewrite intent, never add or remove words, never expand or rephrase, and keep any "for <purpose>" clause exactly as the user wrote it. If nothing is misspelled, return the query EXACTLY as given.

2. "is_product": is this a specific branded/commercial PRODUCT — something with a brand name you'd find on a store shelf or product page (e.g. "Chanel Lotion", "CeraVe Moisturizing Cream", "The Ordinary Niacinamide 10%", "Neutrogena Hydro Boost")? Answer false for a plain ingredient, compound, supplement, or practice on its own, even a well-known one ("niacinamide", "salicylic acid", "ashwagandha", "collagen peptides", "cold plunges") — those are directly searchable on PubMed by name. This EXPLICITLY includes single botanical/plant oils and extracts, which are ingredients, not products, no matter how heavily they're marketed: "batana oil", "rosemary oil", "argan oil", "castor oil", "tamanu oil", "rosehip oil", "sea moss" are all is_product FALSE. A plain ingredient does NOT become a product just because it's currently trending or sold in bottles under many brands — it only counts as a product when the query itself names or clearly implies ONE specific commercial item (a brand, a product line, or "brand + product type" like "Ordinary serum" or "CeraVe cream"). If no brand name is present in the query, is_product is almost always false. Answer true ONLY when the query names or clearly implies a specific commercial product.

3. "is_medicine": is this a SYSTEMIC medicine — a prescription drug or oral/injectable OTC medicine for a diagnosed condition (ibuprofen, metformin, Ozempic, amoxicillin, Prozac, insulin, Tylenol, antihistamines)? Answer false for supplements, vitamins, herbs, foods, wellness practices ("melatonin", "creatine", "electrolytes", "collagen" are NOT medicines here), and false for TOPICAL skincare/haircare actives even when FDA-regulated ("benzoyl peroxide", "salicylic acid", "retinol", "adapalene", "minoxidil", "azelaic acid", sunscreen filters) — those are exactly what this site exists to cover. If true, also set "medicine_name" to the medicine's common name; otherwise "medicine_name" is null.

4. "implied_outcome": ONLY when is_product is true AND the query does NOT already state a purpose (no "for <purpose>" clause): the single main outcome people buy this product for, in 1-4 plain lowercase words suitable as a research search anchor (e.g. "acne", "hair growth", "skin hydration", "wrinkles"). Null in every other case.

Return ONLY this JSON, no other text:
{"corrected_query": "...", "is_product": false, "is_medicine": false, "medicine_name": null, "implied_outcome": null}`;

  const attempt = async (): Promise<QueryClassification | null> => {
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
          max_tokens: 150,
          messages: [{ role: "user", content: prompt }],
        }),
      });
      const json = (await res.json()) as { content: { text: string }[] };
      const text = json.content?.[0]?.text ?? "{}";
      const parsed = JSON.parse(text.replace(/```json|```/g, "").trim()) as {
        corrected_query?: string;
        is_product?: boolean;
        is_medicine?: boolean;
        medicine_name?: string | null;
        implied_outcome?: string | null;
      };
      const corrected =
        typeof parsed.corrected_query === "string" && parsed.corrected_query.trim()
          ? parsed.corrected_query.trim()
          : query;
      return {
        correctedQuery: corrected,
        isProduct: parsed.is_product === true,
        isMedicine: parsed.is_medicine === true,
        medicineName: typeof parsed.medicine_name === "string" && parsed.medicine_name.trim() ? parsed.medicine_name.trim() : null,
        impliedOutcome:
          typeof parsed.implied_outcome === "string" && parsed.implied_outcome.trim()
            ? parsed.implied_outcome.trim()
            : null,
      };
    } catch (e) {
      console.error("[classifyQuery] attempt failed for", JSON.stringify(query), ":", e);
      return null;
    }
  };

  const first = await attempt();
  if (first !== null) return first;
  const second = await attempt();
  if (second !== null) return second;

  console.error("[classifyQuery] both attempts failed for", JSON.stringify(query), "— using query as typed");
  return failOpen;
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
  /** For branded products, the resolved canonical product name (from a real
   *  web search) is a much better Reddit search term than the user's raw
   *  typed query — which might carry a purpose clause, informal phrasing, or
   *  just not match how the product is actually referred to online. Still
   *  run through coreSubjectForReddit before use (see below) since the
   *  canonical name itself can carry a "for X (variant, size)"-style clause.
   *  Falls back to the raw query when not provided. */
  redditQuerySubject?: string;
}): Promise<EvidenceVerdict> {
  const { ids, query, name, slug, updated, generatedAt, pubmedSearchUrl, redditSearchUrl, fallback, redditQuerySubject } = opts;

  // Kick the community scrape off NOW so its (slow) latency overlaps the PubMed
  // article fetch + XML parse + abstract classification below, instead of
  // stacking on top of them. It's awaited just before Claude writes the summary
  // (which needs the quotes), so by then it's had a head start and usually the
  // real quotes are already in hand. .catch keeps a scrape failure from taking
  // down the whole verdict — it just degrades to no quotes for this search.
  // coreSubjectForReddit's "for X" stripping must apply here too, even for
  // the resolved real product name — that name can carry the same "for
  // Digestion (Berry Melon, 50 ct)"-style purpose/variant clause a raw
  // query would, and real Reddit comments never phrase it that way. Passing
  // redditQuerySubject straight through used to skip this cleanup entirely,
  // sending an unnaturally verbose search term that a genuinely relevant,
  // findable thread wouldn't match.
  const communityPromise: Promise<CommunityResult> = fetchCommunityFast(
    coreSubjectForReddit(redditQuerySubject ?? query),
  ).catch(() => ({ quotes: [], sentiment: { score: null, label: null, commentCount: null } }));

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
  //
  // The outcome clause is deliberately KEPT on the subject Claude analyzes
  // against: the analysis prompt's every relevance rule anchors on this
  // string, so passing bare fallback terms ("oleic acid linoleic acid")
  // made Claude judge abstracts against the ingredients with NO outcome —
  // which is how a hair-growth page got muscle-repair bullets. With the
  // outcome retained ("oleic acid, linoleic acid for hair growth"), the
  // wrong-outcome exclusion rules actually engage.
  const subjectOutcome = outcomeClause(query);
  const searchSubject = fallback
    ? subjectOutcome
      ? `${fallback.terms.join(", ")} for ${subjectOutcome}`
      : fallback.terms.join(" ")
    : query;

  // The community scrape was kicked off at the top of this function so it could
  // run while PubMed was being fetched and parsed; collect it now. Claude then
  // cleans/picks the quotes and reads sentiment from them in generateBulletsAndQuotes,
  // so the quotes and the summary derived from them are produced together.
  const community: CommunityResult = await communityPromise;
  const redditQuotes: RedditQuote[] = community.quotes;

  const { displayName, researchVerdict, researchGist, communityVerdict, communityGist, safetyNote, bullets, sentiment: claudeSentiment, category: claudeCategory, verdict: claudeVerdict } =
    await generateBulletsAndQuotes(searchSubject, query, abstractsForClaude, redditQuotes);

  // The backend's sentiment score is computed from the FULL scraped comment
  // pool (up to 150 comments), so it always beats Claude's guess from the
  // <=3 displayed quotes. Claude's number is only a fallback for when the
  // backend didn't return a score (insufficient discussion, older cache).
  const sentiment = community.sentiment.score ?? claudeSentiment;

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

  // Same idea, but short/bulleted — researchGist (from Claude) covers this
  // when available. This ONLY kicks in when that whole call failed, so the
  // hero's bullet list never ends up showing templatedOneLiner's full
  // paragraph disguised as a single "short" bullet — a real regression
  // that happened for a product whose ingredient-fallback path succeeded
  // (real study data, real 27-study count) but the gist-writing call itself
  // failed, so the fallback shown was the long non-gist sentence.
  const verdictGistWord = verdict === "BACKED" ? "mostly backed" : verdict === "DEBUNKED" ? "mostly unsupported" : "mixed evidence";
  const templatedResearchGist: string[] =
    fallback?.reason === "product"
      ? [`No direct studies on this product`, `Key ingredients: ${verdictGistWord}`]
      : fallback?.reason === "terminology"
        ? [`No exact-phrase PubMed results`, `Related research: ${verdictGistWord}`]
        : [`Based on ${studies} PubMed ${studies === 1 ? "study" : "studies"}`, verdictGistWord];
  const finalResearchGist = researchGist.length > 0 ? researchGist : templatedResearchGist;

  const isGenericNoDiscussionPhrase = (s: string) =>
    /limited (public )?discussion|not much (public )?discussion|no (real )?discussion/i.test(s);

  // With zero quotes on hand there is no real signal — never manufacture a
  // "% positive" sentence out of a defaulted number. The client-side
  // re-fetch (search/trend pages) replaces this line once the slow scrape
  // actually lands.
  const communitySummary =
    communityVerdict && !(redditQuotes.length > 0 && isGenericNoDiscussionPhrase(communityVerdict))
      ? communityVerdict
      : redditQuotes.length > 0
        ? `Community sentiment sits at ${sentiment}% positive based on available discussion.`
        : "Community reactions are still being gathered for this one.";

  // Same reasoning as templatedResearchGist — communityGist (from Claude)
  // covers this when available; this only kicks in when that specific part
  // of the call didn't come back, so a long communityVerdict sentence never
  // gets shown disguised as a single short bullet.
  const templatedCommunityGist: string[] =
    redditQuotes.length > 0 ? [`${sentiment}% positive sentiment`] : ["Limited discussion found"];
  const finalCommunityGist = communityGist.length > 0 ? communityGist : templatedCommunityGist;

  const finalSafetyNote = safetyNote ?? "";

  return {
    query, name: finalName, slug, category, verdict, confidence, oneLiner, communityVerdict: communitySummary,
    safetyNote: finalSafetyNote, studies,
    researchGist: finalResearchGist,
    sentiment, updated,
    communityGist: finalCommunityGist,
    bullets, quotes: redditQuotes, articles: articles.slice(0, 6),
    pubmedSearchUrl, redditSearchUrl, generatedAt,
    ingredientFallback: fallback ? fallback.terms : null,
    // Defaulted here; the caller overrides this via spread for branded
    // products where buildIngredientBreakdown actually ran alongside this.
    ingredientBreakdown: null,
    ingredientSource: null,
  };
}

/**
 * Persists a finished EvidenceVerdict to Supabase for the full-result cache
 * (and for "trends verified" / category pages / trending, same as before).
 * Deliberately takes the COMPLETE final object — called once per real
 * generation, at the point a result is about to be returned to the client,
 * after any ingredientBreakdown merge — rather than living inside
 * buildResultFromIds, since that runs in parallel with
 * buildIngredientBreakdown for branded products and wouldn't have the
 * ingredient data yet if it saved itself immediately.
 */
async function persistGeneratedVerdict(result: EvidenceVerdict): Promise<void> {
  await saveGeneratedTrend({
    data: {
      slug: result.slug, query: result.query, name: result.name, category: result.category,
      verdict: result.verdict.toLowerCase() as "backed" | "mixed" | "debunked",
      summary: result.oneLiner, communityVerdict: result.communityVerdict, safetyNote: result.safetyNote,
      studyCount: result.studies, confidence: result.confidence, updated: result.updated,
      evidencePoints: result.bullets.map((b) => b.text), sentiment: result.sentiment, opinions: result.quotes,
      sourceUrls: result.articles.map((a) => a.url),
      bullets: result.bullets, articles: result.articles,
      pubmedSearchUrl: result.pubmedSearchUrl, redditSearchUrl: result.redditSearchUrl, generatedAt: result.generatedAt,
      ingredientFallback: result.ingredientFallback, ingredientBreakdown: result.ingredientBreakdown,
      ingredientSource: result.ingredientSource,
      researchGist: result.researchGist, communityGist: result.communityGist,
    },
  });
}

/**
 * The actual generation pipeline — PubMed, Reddit, Claude, the works.
 * Deliberately NOT a createServerFn itself and takes no cache shortcut —
 * this is what "a fresh generation" means. Two callers: generateEvidenceVerdict
 * below (only reaches this on a cache miss) and adminRegenerateBatch (which
 * calls this directly, on purpose, to force a real regeneration of rows
 * that predate a pipeline/prompt change).
 */
async function generateFreshEvidenceVerdict(rawQuery: string): Promise<EvidenceVerdict> {
  // Classify BEFORE anything else — the corrected query (typo fixes, esp.
  // misspelled brand names) is what the whole pipeline runs on. A misspelled
  // "the ordinaty" used to get zero PubMed hits, fail the product check, and
  // dead-end at "No PubMed results" — now it flows through as the product
  // the user obviously meant. This is also where the (former) separate
  // pharma + branded-product checks got merged into one call, so the serial
  // pre-search latency is one Haiku round-trip, not two.
  const classification = rawQuery ? await classifyQuery(rawQuery) : null;
  const query = classification?.correctedQuery ?? rawQuery;

  const name = toTitleCase(query);
  const slug = slugify(query);
  const pubmedSearchUrl = `https://pubmed.ncbi.nlm.nih.gov/?term=${encodeURIComponent(query)}`;
  const redditSearchUrl = `https://www.reddit.com/search/?q=${encodeURIComponent(query)}`;
  const generatedAt = new Date().toISOString();
  const updated = new Date().toISOString().split("T")[0];

  const empty = (msg: string): EvidenceVerdict => ({
    query, name, slug, category: guessCategoryFallback(query), verdict: "UNKNOWN", confidence: "low",
    oneLiner: msg, researchGist: [], communityVerdict: "", communityGist: [], safetyNote: "", studies: 0, sentiment: 0, updated,
    bullets: [], quotes: [], articles: [],
    pubmedSearchUrl, redditSearchUrl, generatedAt, ingredientFallback: null, ingredientBreakdown: null, ingredientSource: null,
  });

  if (!query) return empty("Enter a search to generate a verdict.");

  if (classification?.isMedicine) {
    // Intentionally not saved to Supabase — pharma queries shouldn't count
    // toward "trends verified" or ever surface as a card anywhere.
    return {
      query, name, slug, category: guessCategoryFallback(query), verdict: "PHARMA", confidence: "low",
      oneLiner: `Veda doesn't cover pharmaceutical medicines like ${classification.medicineName ?? name} — we focus on supplements, wellness practices, and cosmetic ingredients. For questions about medications, talk to a doctor or pharmacist.`,
      researchGist: [], communityVerdict: "", communityGist: [], safetyNote: "", studies: 0, sentiment: 0, updated,
      bullets: [], quotes: [], articles: [],
      pubmedSearchUrl, redditSearchUrl, generatedAt, ingredientFallback: null, ingredientBreakdown: null, ingredientSource: null,
    };
  }

  try {
    const isKnownProduct = classification?.isProduct ?? false;
    const esearch = await fetchPubmed(
      `esearch.fcgi?db=pubmed&retmode=json&retmax=15&sort=relevance&term=${encodeURIComponent(query)}`,
    );
    if (!esearch || !esearch.ok) return empty("Couldn't reach PubMed right now. Try again in a moment.");

    const sj = (await esearch.json()) as { esearchresult?: { idlist?: string[] } };
    const ids = sj.esearchresult?.idlist ?? [];

    // Trigger on WEAK results (too few), IRRELEVANT results (plenty of hits,
    // but not actually about the query's subject), OR a confirmed BRANDED
    // PRODUCT — that last one runs regardless of what the raw PubMed search
    // returned, since a product's name can coincidentally pull in enough
    // loosely-related hits to look "fine" by the other two checks even
    // though it's obviously a product with no direct research of its own.
    // Without this, whether the Key Ingredients section showed up was an
    // accident of PubMed's keyword matching rather than a consistent rule.
    //
    // e.g. "vibration plate for weight loss" returned a few bone-density/
    // neuromuscular studies via literal keyword match, while the real
    // weight-loss-specific research lives under "whole body vibration" +
    // body composition terminology. "stomach vacuums for shrinking waist" is
    // the irrelevant-but-plentiful case: 15/15 hits matched on "waist"/
    // "shrinking" alone (GLP-1, generic aerobic exercise) while missing the
    // real research under "abdominal drawing-in maneuver" terminology.
    const WEAK_RESULT_THRESHOLD = 5;
    const isWeakCount = ids.length < WEAK_RESULT_THRESHOLD;
    const isIrrelevant = !isWeakCount && !isKnownProduct && !(await checkPubmedRelevance(ids, query));
    if (isWeakCount || isIrrelevant || isKnownProduct) {
      let fallback = await identifyFallbackTerms(query);

      // checkIsBrandedProduct (run earlier, dedicated to exactly this
      // question) is the single source of truth for "is this a branded
      // product" — override identifyFallbackTerms's own guess at reason
      // in BOTH directions, not just when it agrees. Without this, a plain
      // ingredient/practice with weak PubMed coverage could still get
      // classified "product" by identifyFallbackTerms's own independent
      // judgment and incorrectly trigger the Key Ingredients section for
      // something that was never actually a product — the exact same kind
      // of inconsistency this whole change was meant to fix, just coming
      // from the other classifier instead.
      if (fallback) fallback.reason = isKnownProduct ? "product" : "terminology";

      // For branded products specifically, try to replace Claude's guessed
      // ingredients with the REAL, sourced list from an actual web search —
      // keyed off isKnownProduct directly, NOT off identifyFallbackTerms
      // having already succeeded. identifyFallbackTerms is deliberately
      // conservative now (told to give up and return null rather than
      // invent garbled ingredient names when it can't identify real ones),
      // and findRealIngredients is a genuinely independent, often more
      // reliable lookup — gating it behind the guesser succeeding first
      // meant a known product could get NO ingredient breakdown at all
      // whenever the guesser gave up, even though the real web search
      // would have worked fine on its own.
      let realIngredients: Awaited<ReturnType<typeof findRealIngredients>> = null;
      if (isKnownProduct) {
        realIngredients = await findRealIngredients(query);
        if (realIngredients) {
          // Synthesize a fallback object if identifyFallbackTerms gave up
          // entirely — the real search succeeding is enough on its own to
          // proceed with the ingredient pipeline below.
          fallback = fallback ?? { reason: "product", terms: [] };
          fallback.reason = "product";
          fallback.terms = realIngredients.keyIngredients;
        }
      }
      const ingredientSource: EvidenceVerdict["ingredientSource"] = realIngredients
        ? { url: realIngredients.sourceUrl, verified: true }
        : fallback?.reason === "product"
          ? { url: null, verified: false }
          : null;

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
        //
        // For the PRODUCT case, fallback.terms are now clean standalone
        // ingredient names (so they can be shown as "Key ingredients: ..."
        // without looking like garbled search phrases) — but that means
        // they no longer carry the query's outcome/purpose on their own.
        // Searching bare "ursolic acid" pulls in whatever that compound is
        // MOST studied for (antiparasitic activity, drug metabolism), which
        // is very often not the actual claim. Re-attaching the outcome here
        // (search-only, the display name stays clean) keeps the search
        // anchored to what's actually being asked about.
        // For products with no explicit "for Y" clause, fall back to the
        // classifier's implied outcome ("acne" for an acne serum) — a bare
        // ingredient search with no outcome anchor drifts into whatever the
        // compound is most-studied for generally, which is a top source of
        // junk bullets on branded-product pages.
        const queryOutcome = outcomeClause(query) ?? classification?.impliedOutcome ?? null;
        // Outcome anchoring applies to BOTH fallback reasons, not just
        // products. identifyFallbackTerms is told to keep terminology terms
        // outcome-targeted, but it doesn't always comply — "batana oil for
        // hair growth" came back as bare fatty-acid names, whose UNANCHORED
        // search surfaced muscle-injury studies that became the page's
        // bullets. Re-attaching the outcome here makes that impossible; a
        // term that already contains the outcome just repeats a token,
        // which is harmless to PubMed's AND semantics.
        const fallbackTerm = fallback.terms
          .map((t) => t.replace(/[()"]/g, "").trim())
          .filter(Boolean)
          .map((t) => (queryOutcome ? `(${t} ${queryOutcome})` : t))
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
            //
            // For a KNOWN PRODUCT, the raw-name search's ids are excluded
            // entirely: PubMed never indexes a commercial product by name,
            // so whatever that search returned matched on incidental shared
            // words ("ordinary", "hydro", "boost") — feeding those abstracts
            // to the bullet-writer alongside the real ingredient research is
            // where most branded-product junk bullets came from.
            const mergedIds = isKnownProduct
              ? fallbackIds.slice(0, 15)
              : Array.from(new Set([...fallbackIds, ...ids])).slice(0, 15);

            // Runs alongside buildResultFromIds (not after it) since they
            // don't depend on each other — this is the extra per-ingredient
            // breakdown for branded products only ("Chanel Lotion" -> what
            // does the research say about EACH of its key ingredients),
            // buildResultFromIds still produces the main blended verdict.
            const [result, ingredientBreakdown] = await Promise.all([
              buildResultFromIds({
                ids: mergedIds,
                query, name: realIngredients?.productName ?? name, slug, updated, generatedAt,
                pubmedSearchUrl: `https://pubmed.ncbi.nlm.nih.gov/?term=${encodeURIComponent(fallbackTerm)}`,
                redditSearchUrl,
                fallback,
                redditQuerySubject: realIngredients?.productName,
              }),
              fallback.reason === "product"
                ? buildIngredientBreakdown(realIngredients?.productName ?? name, fallback.terms, queryOutcome)
                : Promise.resolve(null),
            ]);

            // Separate cards for the top 3 ingredients (same style as every
            // other bullet) instead of one folded summary line — the
            // per-ingredient research check still runs exactly as before via
            // buildIngredientBreakdown above, this just changes how the
            // result is surfaced.
            const ingredientBullets = ingredientBreakdown
              ? buildIngredientBullets(ingredientBreakdown, ingredientSource)
              : [];

            // The banner shows `studies` as "how much research backs this
            // page" — without this, it only counted the merged product-level
            // search, so a product with zero direct hits but real,
            // well-studied ingredients would show "BASED ON 0 PUBMED
            // STUDIES" directly above a bullet saying the ingredient
            // research is mixed/backed, a real contradiction. These are
            // genuinely separate searches (one product-level, one per
            // ingredient), so the honest total is both added together.
            const ingredientStudyTotal = (ingredientBreakdown ?? []).reduce((sum, i) => sum + i.studies, 0);

            const merged: EvidenceVerdict = {
              ...result,
              // The verified real product name always wins over Claude's
              // own "X for Y" reconstruction of the raw search query — that
              // reconstruction is built from the user's literal wording and
              // has no idea a real product was actually identified, so it
              // silently discarded it. Without this, the page could show an
              // ingredient breakdown for a specific verified bottle while
              // titling itself with whatever the user happened to type.
              name: realIngredients?.productName ?? result.name,
              studies: result.studies + ingredientStudyTotal,
              bullets: [...ingredientBullets, ...result.bullets],
              ingredientBreakdown,
              ingredientSource,
            };
            await persistGeneratedVerdict(merged);
            return merged;
          }
        }
      }

      if (ids.length > 0) {
        // Fallback search found nothing better — the original (weak but
        // non-empty) results are still the best we have, use them.
        const result = await buildResultFromIds({
          ids, query, name, slug, updated, generatedAt,
          pubmedSearchUrl, redditSearchUrl, fallback: null,
        });
        await persistGeneratedVerdict(result);
        return result;
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

    const result = await buildResultFromIds({
      ids, query, name, slug, updated, generatedAt,
      pubmedSearchUrl, redditSearchUrl, fallback: null,
    });
    await persistGeneratedVerdict(result);
    return result;
  } catch {
    return empty("Couldn't reach PubMed right now. Try again in a moment.");
  }
}

export const generateEvidenceVerdict = createServerFn({ method: "GET" })
  .inputValidator((d: { query: string }) => ({ query: String(d.query || "").slice(0, 200) }))
  .handler(async ({ data }): Promise<EvidenceVerdict> => {
    const query = data.query.trim();
    if (!query) return generateFreshEvidenceVerdict(query);

    const slug = slugify(query);

    // Cache: if this exact query was already fully generated recently, serve
    // that instead of regenerating from scratch. Every visit used to re-run
    // the ENTIRE pipeline (PubMed, Reddit, 2-3 Claude calls) even for a query
    // searched a minute ago — slow, costly, and since none of those calls are
    // fully deterministic, a re-generation could come back subtly different
    // each time (a bullet reworded, an ingredient's verdict flipping), which
    // is why leaving and coming back to "the same" result could look like
    // things were disappearing or changing. A cache hit returns the exact
    // same saved object, not a fresh roll of the dice.
    const CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
    const cached = await getGeneratedEvidenceBySlug({ data: { slug } });
    if (cached && Date.now() - new Date(cached.generatedAt).getTime() < CACHE_MAX_AGE_MS) {
      return cached;
    }

    return generateFreshEvidenceVerdict(query);
  });

/**
 * Admin-only forced regeneration, in small batches — used after a pipeline
 * or prompt change to bring existing cached rows up to date, WITHOUT
 * blindly re-running every row in one shot (expensive in both API spend
 * and PubMed rate limits, and one request would almost certainly hit a
 * serverless function timeout long before finishing 100+ rows).
 *
 * Call repeatedly from the client with an increasing offset (the response's
 * nextOffset) until it comes back null — each call handles a small slice
 * (default 3 rows) and returns immediately after, so the admin page can
 * show live progress and the whole thing can be stopped between batches.
 *
 * mode "stale" (default): only rows missing the rich cache fields (written
 * before the 0007 migration) or past the same 7-day cache window regular
 * visits use — i.e. only rows that would regenerate on their own eventually
 * anyway, just doing it proactively/in bulk. mode "all": every real
 * (non-unmapped) row, regardless of freshness — meaningfully more API
 * spend, meant for "I changed a prompt and want everything to reflect it
 * now," not a routine action.
 */
export const adminRegenerateBatch = createServerFn({ method: "POST" })
  .inputValidator((d: { password: string; offset: number; limit?: number; mode?: "stale" | "all" }) => d)
  .handler(
    async ({
      data,
    }): Promise<{ ok: boolean; processed?: number; failed?: number; total?: number; nextOffset?: number | null; error?: string }> => {
      if (!checkAdminPassword(data.password)) return { ok: false, error: "Wrong password." };

      try {
        const limit = Math.min(Math.max(data.limit ?? 3, 1), 10);
        const supabase = getSupabaseServiceClient();

        let queryBuilder = supabase
          .from("generated_trends")
          .select("id, query, generated_at, bullets", { count: "exact" })
          .neq("verdict", "unmapped")
          .order("id", { ascending: true })
          .range(data.offset, data.offset + limit - 1);

        const { data: rows, error, count } = await queryBuilder;
        if (error || !rows) return { ok: false, error: "Couldn't load trends." };

        const CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
        const isStale = (row: { generated_at: string | null; bullets: unknown[] | null }) =>
          !row.generated_at ||
          !row.bullets ||
          row.bullets.length === 0 ||
          Date.now() - new Date(row.generated_at).getTime() >= CACHE_MAX_AGE_MS;

        const targets = data.mode === "all" ? rows : rows.filter(isStale);

        let processed = 0;
        let failed = 0;
        for (const row of targets) {
          try {
            await generateFreshEvidenceVerdict(row.query);
            processed++;
          } catch {
            failed++;
          }
        }

        const nextOffset = data.offset + rows.length;
        const done = !count || nextOffset >= count || rows.length < limit;
        return { ok: true, processed, failed, total: count ?? undefined, nextOffset: done ? null : nextOffset };
      } catch {
        return { ok: false, error: "Regenerate batch failed." };
      }
    },
  );
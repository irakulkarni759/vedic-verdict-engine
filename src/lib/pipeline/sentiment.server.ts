import { tavilySearch, type SearchResult } from "./tavilySearch.server";
import { scrapePageText } from "./htmlText.server";
import { askClaude, parseClaudeJson } from "./anthropic.server";

// Ported from find_discussion_pages() / analyze_community_sentiment() in the
// notebook. The forum/affiliate heuristics are unchanged; DDGS is swapped
// for braveSearch().

const FORUM_DOMAINS = [
  "reddit.com",
  "old.reddit.com",
  "quora.com",
  "stackexchange.com",
  "forum.",
  "community.",
  "boards.",
  "talk.",
  "skincareaddiction",
];

const AFFILIATE_URL_MARKERS = [
  "srsltid=",
  "tag=",
  "aff=",
  "affiliate",
  "ref=",
  "utm_",
  "clickid",
  "skimresref",
  "/go/",
  "/recommends/",
  "redirect",
  "partner",
  "amzn.to",
  "rstyle.me",
  "shareasale",
  "/shop",
  "/buy",
  "/deal",
  "coupon",
];

const COMMERCE_DOMAINS = [
  "amazon.",
  "sephora.",
  "ulta.",
  "walmart.",
  "target.",
  "shopify",
  "/products/",
  ".myshopify.",
];

const SKIP_DOMAINS = ["youtube.", "instagram.", "facebook.", "tiktok.", "pinterest."];

function isForum(url: string): boolean {
  const u = url.toLowerCase();
  return FORUM_DOMAINS.some((d) => u.includes(d));
}

function looksAffiliate(url: string): boolean {
  const u = url.toLowerCase();
  if (COMMERCE_DOMAINS.some((d) => u.includes(d))) return true;
  return AFFILIATE_URL_MARKERS.some((m) => u.includes(m));
}

export async function findDiscussionPages(
  userQuery: string,
  maxResults = 6,
): Promise<{ forum: SearchResult[]; blog: SearchResult[] }> {
  // Queries biased toward honest discussion, NOT "review" (which is affiliate-bait)
  const searchQueries = [
    `site:reddit.com ${userQuery}`,
    `${userQuery} reddit worth it OR honest OR disappointed`,
    `${userQuery} my experience`,
  ];

  const forum: SearchResult[] = [];
  const blog: SearchResult[] = [];
  const seen = new Set<string>();

  for (const q of searchQueries) {
    const results = await tavilySearch(q, maxResults);
    for (const r of results) {
      if (!r.url || seen.has(r.url)) continue;
      if (SKIP_DOMAINS.some((d) => r.url.includes(d))) continue;
      if (looksAffiliate(r.url)) continue;
      seen.add(r.url);
      (isForum(r.url) ? forum : blog).push(r);
    }
  }

  return { forum, blog };
}

export interface SentimentResult {
  overall: string;
  positive_themes: string[];
  negative_themes: string[];
  quotes: { text: string; url: string }[];
  notes: string;
  source_urls: string[];
  excluded_sources: string[];
}

// Normalize text so a quote can be checked against the source it supposedly
// came from, tolerant of smart quotes / punctuation / spacing differences.
function normalizeForMatch(s: string): string {
  return s
    .toLowerCase()
    .replace(/[\u2018\u2019\u201c\u201d]/g, "'")
    .replace(/[^a-z0-9' ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

interface RawSentiment {
  overall?: string;
  positive_themes?: string[];
  negative_themes?: string[];
  quotes?: { text?: string; source?: string }[];
  notes?: string;
  excluded_sources?: string[];
}

/** Light-volume sentiment layer. Anecdotal — not evidence. Claude rates each
 * source's commercial intent and bases sentiment on genuine user content only. */
export async function analyzeCommunitySentiment(
  userQuery: string,
  maxPages = 5,
  maxBlogs = 2,
): Promise<SentimentResult> {
  const { forum, blog } = await findDiscussionPages(userQuery);
  const ordered = [...forum, ...blog.slice(0, maxBlogs)].slice(0, maxPages);

  const sources: { url: string; text: string; kind: "FORUM" | "BLOG" }[] = [];
  for (const r of ordered) {
    // Prefer Tavily's own extracted text — it fetches the page server-side and
    // works for Reddit/forums that block our direct static scraper. Fall back
    // to the snippet, then to scraping, only if needed.
    let text = (r.rawContent ?? "").trim();
    if (!text) text = (r.description ?? "").trim();
    if (!text) text = await scrapePageText(r.url, 8000);
    if (text) {
      sources.push({ url: r.url, text: text.slice(0, 8000), kind: isForum(r.url) ? "FORUM" : "BLOG" });
    }
  }
  const usedUrls = sources.map((s) => s.url);

  if (sources.length === 0) {
    return {
      overall: "unknown",
      positive_themes: [],
      negative_themes: [],
      quotes: [],
      notes: "No genuine community discussion could be retrieved.",
      source_urls: [],
      excluded_sources: [],
    };
  }

  const combined = sources
    .map((s) => `SOURCE (${s.kind}) ${s.url}\n${s.text}`)
    .join("\n\n---\n\n")
    .slice(0, 28000);
  const prompt = `You are analyzing COMMUNITY SENTIMENT for a wellness/skincare product.
This is anecdotal user opinion - NOT scientific evidence.

The user does NOT want affiliate/sponsored/marketing content influencing the result.
Each source is tagged FORUM (likely genuine discussion) or BLOG (verify intent).

Product / query:
${userQuery}

Scraped sources:
${combined}

First, judge each source: is it genuine user discussion, or promotional/affiliate/sponsored content
(e.g. "buy now", discount codes, "best X of 2026" roundups, uniformly glowing with purchase links)?
EXCLUDE promotional sources from the sentiment, themes, and quotes. Only use genuine user opinion.

Return valid JSON only, no preamble:
{
  "overall": "positive / mostly positive / mixed / mostly negative / negative",
  "positive_themes": ["short phrases users genuinely praise"],
  "negative_themes": ["short phrases for genuine complaints / skepticism"],
  "quotes": [{"text":"a VERBATIM quote copied exactly from one source, under 25 words","source":"the exact SOURCE url that quote was copied from"}],
  "notes": "1-2 sentences: how many sources were genuine vs excluded as promotional, and overall reliability",
  "excluded_sources": ["URLs you judged promotional/affiliate and excluded"]
}

Rules:
- Quotes MUST be copied word-for-word from the source text above — do NOT paraphrase, summarize, or invent. If you cannot find a real verbatim quote, return an empty quotes array.
- Each quote's "source" must be the exact URL of the source it came from.
- Base everything ONLY on genuine (non-promotional) text.
- If a source is marketing, exclude it and note it in excluded_sources.
- If ALL sources look promotional, set overall to "unknown" and say so in notes.`;

  const raw = await askClaude(prompt, 1100);
  const parsed = parseClaudeJson<RawSentiment>(raw);

  if (!parsed) {
    return {
      overall: "unknown",
      positive_themes: [],
      negative_themes: [],
      quotes: [],
      notes: "Could not parse sentiment response.",
      source_urls: usedUrls,
      excluded_sources: [],
    };
  }

  // Anti-hallucination guard: only keep a quote if it actually appears in the
  // scraped text. A made-up or paraphrased "quote" won't match and is dropped.
  const normalizedByUrl = new Map(sources.map((s) => [s.url, normalizeForMatch(s.text)]));
  const allNormalized = sources.map((s) => normalizeForMatch(s.text)).join(" \n ");
  const verifiedQuotes: { text: string; url: string }[] = [];
  for (const q of parsed.quotes ?? []) {
    const text = (q?.text ?? "").trim();
    if (!text) continue;
    // Use the first ~10 words as the probe — a verbatim run that long is not
    // something the model could match by coincidence if it invented the quote.
    const probe = normalizeForMatch(text).split(" ").filter(Boolean).slice(0, 10).join(" ");
    if (!probe) continue;
    const claimed = q?.source ? normalizedByUrl.get(q.source) : undefined;
    if (claimed && claimed.includes(probe)) {
      verifiedQuotes.push({ text, url: q!.source! });
    } else if (allNormalized.includes(probe)) {
      // Quote is real but attributed to the wrong source — find the real one.
      const realUrl = sources.find((s) => normalizeForMatch(s.text).includes(probe))?.url ?? "";
      verifiedQuotes.push({ text, url: realUrl });
    }
    // else: not found in any source → hallucinated/paraphrased → drop it.
  }

  return {
    overall: parsed.overall ?? "unknown",
    positive_themes: parsed.positive_themes ?? [],
    negative_themes: parsed.negative_themes ?? [],
    quotes: verifiedQuotes,
    notes: parsed.notes ?? "",
    source_urls: usedUrls,
    excluded_sources: parsed.excluded_sources ?? [],
  };
}

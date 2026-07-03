import { createServerFn } from "@tanstack/react-start";

/**
 * Real Reddit comments, fetched from a standalone Python service deployed on
 * Railway (repo: veda-sentiment-backend). That service handles the TLS
 * fingerprinting Reddit's WAF requires — something Cloudflare Workers can't
 * do natively, which is why this couldn't live in this app directly.
 *
 * The Railway service selects "top_quotes" itself using a relevance check
 * (Claude judges which comments are genuinely on-topic vs. just high-score
 * but unrelated) — so we use that curated list directly rather than
 * re-sorting the raw comment pool by score here.
 *
 * Contract unchanged from before: real quotes only, [] on any failure or
 * when nothing usable/relevant is found — never a fabricated fallback.
 */
export type RedditQuote = {
  handle: string;
  text: string;
  url: string; // real permalink
};

const SENTIMENT_API_URL =
  process.env.VEDA_SENTIMENT_API_URL ??
  "https://veda-sentiment-backend-production.up.railway.app";

type SentimentApiTopQuote = {
  body: string;
  score: number;
  subreddit: string | null;
  author?: string | null;
  url?: string | null;
};

type SentimentApiResponse = {
  top_quotes: SentimentApiTopQuote[];
};

/** Truncate at the last full sentence within maxLength, falling back to the
 *  last word boundary — never a mid-word/mid-sentence chop like "...aft". */
function truncateAtWordBoundary(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;

  const slice = text.slice(0, maxLength);
  const lastSentenceEnd = Math.max(
    slice.lastIndexOf(". "),
    slice.lastIndexOf("! "),
    slice.lastIndexOf("? ")
  );
  if (lastSentenceEnd > maxLength * 0.5) {
    return slice.slice(0, lastSentenceEnd + 1);
  }

  const lastSpace = slice.lastIndexOf(" ");
  return (lastSpace > 0 ? slice.slice(0, lastSpace) : slice) + "...";
}

async function fetchOnce(query: string, timeoutMs: number): Promise<Response | null> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(
      `${SENTIMENT_API_URL}/api/claim?query=${encodeURIComponent(query)}`,
      { signal: controller.signal }
    );
    return res;
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

/** Fast path: single 5s attempt, no retry. Used inside the main verdict
 *  generation request — that request already has PubMed + Claude latency,
 *  so it can't afford a 25s worst case on top just for Reddit quotes. */
export async function fetchRedditQuotesFast(query: string, limit = 3): Promise<RedditQuote[]> {
  const res = await fetchOnce(query, 5000);
  return parseQuotesResponse(res, limit);
}

/** Slow path: 5s try, then a 20s retry. Used only for the client-triggered
 *  async re-fetch (see getRedditQuotes below), which runs after the page has
 *  already rendered, so a cold Railway container doesn't block anything. */
export async function fetchRedditQuotes(query: string, limit = 3): Promise<RedditQuote[]> {
  try {
    let res = await fetchOnce(query, 5000);
    if (!res || !res.ok) {
      res = await fetchOnce(query, 20000);
    }
    return await parseQuotesResponse(res, limit);
  } catch {
    return [];
  }
}

async function parseQuotesResponse(res: Response | null, limit: number): Promise<RedditQuote[]> {
  try {
    if (!res || !res.ok) return [];
    const data: SentimentApiResponse = await res.json();
    if (!data.top_quotes || data.top_quotes.length === 0) return [];

    const quotes: RedditQuote[] = [];
    for (const c of data.top_quotes) {
      if (!c.body || !c.url) continue;
      quotes.push({
        handle: c.author ? `u/${c.author}` : `r/${c.subreddit ?? "reddit"}`,
        text: truncateAtWordBoundary(c.body, 600),
        url: c.url,
      });
      if (quotes.length >= limit) break;
    }
    return quotes;
  } catch {
    return [];
  }
}

/** Client-callable wrapper, used to live-fetch quotes for curated trends
 *  (which have no DB row to cache them in) at page-load time. */
export const getRedditQuotes = createServerFn({ method: "GET" })
  .inputValidator((d: { query: string }) => d)
  .handler(async ({ data }): Promise<RedditQuote[]> => fetchRedditQuotes(data.query));

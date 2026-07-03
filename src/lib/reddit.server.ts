import { createServerFn } from "@tanstack/react-start";

/**
 * Real Reddit comments, fetched from a standalone Python service deployed on
 * Railway (repo: veda-sentiment-backend). That service handles the TLS
 * fingerprinting Reddit's WAF requires — something Cloudflare Workers can't
 * do natively, which is why this couldn't live in this app directly.
 *
 * Contract unchanged from before: real quotes only, [] on any failure or
 * when nothing usable is found — never a fabricated fallback.
 */
export type RedditQuote = {
  handle: string;
  text: string;
  url: string; // real permalink
};

const SENTIMENT_API_URL =
  process.env.VEDA_SENTIMENT_API_URL ??
  "https://veda-sentiment-backend-production.up.railway.app";

type SentimentApiComment = {
  body: string;
  score: number;
  subreddit: string | null;
  author?: string | null;
  url?: string | null;
};

type SentimentApiResponse = {
  comments: SentimentApiComment[];
};

export async function fetchRedditQuotes(query: string, limit = 3): Promise<RedditQuote[]> {
  try {
    const res = await fetch(
      `${SENTIMENT_API_URL}/api/claim?query=${encodeURIComponent(query)}`
    );
    if (!res.ok) return [];

    const data: SentimentApiResponse = await res.json();
    if (!data.comments || data.comments.length === 0) return [];

    // Highest-score comments first — these are the ones the community
    // actually upvoted, so they're the most representative to surface.
    const ranked = [...data.comments].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

    const quotes: RedditQuote[] = [];
    for (const c of ranked) {
      if (!c.body || !c.url) continue;
      quotes.push({
        handle: c.author ? `u/${c.author}` : `r/${c.subreddit ?? "reddit"}`,
        text: c.body.length > 300 ? c.body.slice(0, 297) + "..." : c.body,
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

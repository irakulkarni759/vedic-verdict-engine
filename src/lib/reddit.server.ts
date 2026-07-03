import { createServerFn } from "@tanstack/react-start";
import { fetchYouTubeQuotes, YouTubeQuotaExceededError } from "./youtube.server";

export { YouTubeQuotaExceededError };

/**
 * TEMPORARY: the actual data source here is YouTube comments, not Reddit
 * (see youtube.server.ts) — Reddit's official API required approval we hit
 * friction on, and their public unauthenticated endpoint turned out to be
 * fully blocked from this app's server IPs (confirmed: 0/42 trends got
 * real quotes when tested). Names/exports and the site's "Reddit" copy are
 * kept as-is for now so the underlying real-quotes mechanism can be tested
 * before deciding whether to rebrand this section.
 *
 * The contract hasn't changed: real quotes only, [] on any failure or when
 * nothing usable is found — never a fabricated fallback.
 */
export type RedditQuote = {
  handle: string;
  text: string;
  url: string; // real permalink
};

export async function fetchRedditQuotes(query: string, limit = 3): Promise<RedditQuote[]> {
  return fetchYouTubeQuotes(query, limit);
}

/** Client-callable wrapper, used to live-fetch quotes for curated trends
 *  (which have no DB row to cache them in) at page-load time. */
export const getRedditQuotes = createServerFn({ method: "GET" })
  .inputValidator((d: { query: string }) => d)
  .handler(async ({ data }): Promise<RedditQuote[]> => fetchRedditQuotes(data.query));

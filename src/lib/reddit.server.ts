import { createServerFn } from "@tanstack/react-start";

/**
 * Real Reddit comments only — no fabricated quotes, ever. If nothing
 * relevant/usable turns up, callers should show nothing rather than
 * inventing something.
 *
 * Uses Reddit's public, unauthenticated JSON endpoints rather than the
 * official OAuth Data API — Reddit's developer-app approval process has
 * become enough of a barrier that requiring it here would just mean this
 * feature silently doesn't work for most people. The public endpoint has
 * no such gate, but comes with a real tradeoff: no guarantees, and Reddit
 * can rate-limit or block it without notice. When that happens this
 * returns [] and callers fall back to no quotes — never fabricated ones.
 */
export type RedditQuote = {
  handle: string; // "u/username"
  text: string;
  url: string; // real permalink to the comment or post
};

const USER_AGENT = "veda-wellness-app/1.0 (by /u/veda_research)";

type RedditCommentData = {
  author?: string;
  body?: string;
  permalink?: string;
  score?: number;
};

type RedditPostData = {
  author?: string;
  title?: string;
  selftext?: string;
  permalink?: string;
  score?: number;
};

function isUsable(text: string | undefined): text is string {
  return !!text && text !== "[deleted]" && text !== "[removed]" && text.length >= 40;
}

function truncate(text: string, max = 280): string {
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

async function searchReddit<T>(
  query: string,
  type: "comment" | "link",
): Promise<{ data?: { children?: { data: T }[] } } | null> {
  try {
    const res = await fetch(
      `https://www.reddit.com/search.json?q=${encodeURIComponent(query)}&type=${type}&sort=relevance&limit=15&raw_json=1`,
      { headers: { "User-Agent": USER_AGENT } },
    );
    if (!res.ok) return null;
    return (await res.json()) as { data?: { children?: { data: T }[] } };
  } catch {
    return null;
  }
}

/**
 * Searches real Reddit content mentioning `query`, returns up to `limit`
 * genuine quotes with real usernames and real permalinks. Tries comments
 * first (more quote-like/conversational), falls back to post text if
 * comment search comes up empty. Filters out deleted/removed authors,
 * empty bodies, and anything too short to be a meaningful reaction.
 * Returns [] on any failure or when nothing usable is found.
 */
export async function fetchRedditQuotes(query: string, limit = 3): Promise<RedditQuote[]> {
  const commentResults = await searchReddit<RedditCommentData>(query, "comment");
  const commentCandidates = (commentResults?.data?.children ?? [])
    .map((c) => c.data)
    .filter(
      (d): d is Required<Pick<RedditCommentData, "author" | "body" | "permalink">> & RedditCommentData =>
        !!d.author && d.author !== "[deleted]" && isUsable(d.body) && !!d.permalink,
    )
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

  if (commentCandidates.length > 0) {
    return commentCandidates.slice(0, limit).map((c) => ({
      handle: `u/${c.author}`,
      text: truncate(c.body!),
      url: `https://www.reddit.com${c.permalink}`,
    }));
  }

  // Fall back to post text (title + selftext) when comment search comes up
  // empty — still 100% real content with a real author and permalink.
  const postResults = await searchReddit<RedditPostData>(query, "link");
  const postCandidates = (postResults?.data?.children ?? [])
    .map((p) => p.data)
    .filter(
      (d): d is Required<Pick<RedditPostData, "author" | "selftext" | "permalink">> & RedditPostData =>
        !!d.author && d.author !== "[deleted]" && isUsable(d.selftext) && !!d.permalink,
    )
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

  return postCandidates.slice(0, limit).map((p) => ({
    handle: `u/${p.author}`,
    text: truncate(p.selftext!),
    url: `https://www.reddit.com${p.permalink}`,
  }));
}

/** Client-callable wrapper, used to live-fetch quotes for curated trends
 *  (which have no DB row to cache them in) at page-load time. */
export const getRedditQuotes = createServerFn({ method: "GET" })
  .inputValidator((d: { query: string }) => d)
  .handler(async ({ data }): Promise<RedditQuote[]> => fetchRedditQuotes(data.query));

import { createServerFn } from "@tanstack/react-start";

/**
 * Real Reddit comments only — no fabricated quotes, ever. If nothing
 * relevant/usable turns up, callers should show nothing rather than
 * inventing something. Requires REDDIT_CLIENT_ID / REDDIT_CLIENT_SECRET
 * (a free "script" app at https://www.reddit.com/prefs/apps).
 */
export type RedditQuote = {
  handle: string; // "u/username"
  text: string;
  url: string; // real permalink to the comment
};

type CachedToken = { token: string; expiresAt: number };
let cachedToken: CachedToken | null = null;

async function getRedditAccessToken(): Promise<string | null> {
  const clientId = process.env.REDDIT_CLIENT_ID;
  const clientSecret = process.env.REDDIT_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  if (cachedToken && cachedToken.expiresAt > Date.now() + 30_000) {
    return cachedToken.token;
  }

  try {
    const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
    const res = await fetch("https://www.reddit.com/api/v1/access_token", {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "veda-wellness-app/1.0",
      },
      body: "grant_type=client_credentials",
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!json.access_token) return null;

    cachedToken = {
      token: json.access_token,
      expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000,
    };
    return cachedToken.token;
  } catch {
    return null;
  }
}

type RedditCommentData = {
  author?: string;
  body?: string;
  permalink?: string;
  score?: number;
};

/**
 * Searches real Reddit comments mentioning `query`, returns up to `limit`
 * genuine quotes with real usernames and real permalinks. Filters out
 * deleted/removed authors, empty bodies, bot-like content, and anything
 * too short to be a meaningful reaction. Returns [] on any failure or when
 * nothing usable is found — callers must not fall back to fabricated quotes.
 */
export async function fetchRedditQuotes(query: string, limit = 3): Promise<RedditQuote[]> {
  const token = await getRedditAccessToken();
  if (!token) return [];

  try {
    const res = await fetch(
      `https://oauth.reddit.com/search?q=${encodeURIComponent(query)}&type=comment&sort=relevance&limit=15&raw_json=1`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "User-Agent": "veda-wellness-app/1.0",
        },
      },
    );
    if (!res.ok) return [];

    const json = (await res.json()) as {
      data?: { children?: { data: RedditCommentData }[] };
    };
    const children = json.data?.children ?? [];

    const candidates = children
      .map((c) => c.data)
      .filter(
        (d): d is Required<Pick<RedditCommentData, "author" | "body" | "permalink">> & RedditCommentData =>
          !!d.author &&
          d.author !== "[deleted]" &&
          !!d.body &&
          d.body !== "[deleted]" &&
          d.body !== "[removed]" &&
          d.body.length >= 40 &&
          !!d.permalink,
      )
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

    return candidates.slice(0, limit).map((c) => ({
      handle: `u/${c.author}`,
      text: c.body!.length > 280 ? `${c.body!.slice(0, 277)}...` : c.body!,
      url: `https://www.reddit.com${c.permalink}`,
    }));
  } catch {
    return [];
  }
}

/** Client-callable wrapper, used to live-fetch quotes for curated trends
 *  (which have no DB row to cache them in) at page-load time. */
export const getRedditQuotes = createServerFn({ method: "GET" })
  .inputValidator((d: { query: string }) => d)
  .handler(async ({ data }): Promise<RedditQuote[]> => fetchRedditQuotes(data.query));

/**
 * Real YouTube comments, used as the actual data source behind
 * fetchRedditQuotes() in reddit.server.ts (temporary — naming/copy on the
 * site still says "Reddit" pending a decision on whether to rebrand this
 * section). Real usernames, real comment text, real permalinks — same
 * "never fabricate, return [] on failure" contract as before.
 *
 * Requires YOUTUBE_API_KEY (free, no approval process — a Google Cloud
 * project + "Enable API" + "Create API Key", ~10 minutes, no credit card).
 */

export type CommunityQuote = {
  handle: string;
  text: string;
  url: string;
};

type YouTubeSearchItem = {
  id?: { videoId?: string };
};

type YouTubeCommentThreadItem = {
  id?: string;
  snippet?: {
    videoId?: string;
    topLevelComment?: {
      snippet?: {
        authorDisplayName?: string;
        textDisplay?: string;
        textOriginal?: string;
        likeCount?: number;
      };
    };
  };
};

function isUsable(text: string | undefined): text is string {
  return !!text && text.trim().length >= 40;
}

function truncate(text: string, max = 280): string {
  const clean = text.trim();
  return clean.length > max ? `${clean.slice(0, max - 3)}...` : clean;
}

const STOPWORDS = new Set([
  "for", "the", "a", "an", "and", "or", "with", "to", "of", "in", "on",
  "is", "are", "does", "do", "vs", "how", "what", "best", "good", "help",
]);

/** Significant words from the query — used to check a comment actually
 *  relates to the topic, not just that it appeared on a loosely-matched
 *  video. Longer words are more distinctive; shorter/common ones are noise. */
function extractKeywords(query: string): string[] {
  return query
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.replace(/[^\w]/g, ""))
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
}

/** Requires the comment to actually mention the topic — a real YouTube
 *  comment on a loosely-related video (e.g. griping about ads or filters)
 *  is still not a relevant "community reaction" if it never mentions what
 *  was searched. */
function isRelevant(text: string, keywords: string[]): boolean {
  if (keywords.length === 0) return true;
  const lower = text.toLowerCase();
  return keywords.some((k) => lower.includes(k));
}

async function searchVideos(query: string, apiKey: string, maxResults = 8): Promise<string[]> {
  try {
    const res = await fetch(
      `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&order=relevance&maxResults=${maxResults}&q=${encodeURIComponent(query)}&key=${apiKey}`,
    );
    if (!res.ok) return [];
    const json = (await res.json()) as { items?: YouTubeSearchItem[] };
    return (json.items ?? [])
      .map((item) => item.id?.videoId)
      .filter((id): id is string => !!id);
  } catch {
    return [];
  }
}

async function fetchCommentsForVideo(
  videoId: string,
  apiKey: string,
  maxResults = 30,
): Promise<{ handle: string; text: string; url: string; likeCount: number }[]> {
  try {
    const res = await fetch(
      `https://www.googleapis.com/youtube/v3/commentThreads?part=snippet&videoId=${videoId}&order=relevance&maxResults=${maxResults}&textFormat=plainText&key=${apiKey}`,
    );
    // Comments can be disabled on a video (403) — not an error worth surfacing, just skip it.
    if (!res.ok) return [];
    const json = (await res.json()) as { items?: YouTubeCommentThreadItem[] };

    return (json.items ?? [])
      .map((item) => {
        const snippet = item.snippet?.topLevelComment?.snippet;
        const commentId = item.id;
        const text = snippet?.textOriginal ?? snippet?.textDisplay;
        const author = snippet?.authorDisplayName;
        if (!isUsable(text) || !author || !commentId) return null;
        return {
          handle: author.startsWith("@") ? author : `@${author}`,
          text: truncate(text),
          url: `https://www.youtube.com/watch?v=${videoId}&lc=${commentId}`,
          likeCount: snippet?.likeCount ?? 0,
        };
      })
      .filter((c): c is { handle: string; text: string; url: string; likeCount: number } => c !== null);
  } catch {
    return [];
  }
}

/**
 * Searches real YouTube videos about `query`, pulls top comments from the
 * most relevant few, filters to ones that actually mention the topic, and
 * returns up to `limit` genuine quotes sorted by like count. Returns []
 * on any failure, missing API key, or when nothing usable/relevant is
 * found — callers must not fall back to fabricated quotes.
 */
export async function fetchYouTubeQuotes(query: string, limit = 3): Promise<CommunityQuote[]> {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) return [];

  const keywords = extractKeywords(query);

  const videoIds = await searchVideos(query, apiKey);
  if (videoIds.length === 0) return [];

  const commentBatches = await Promise.all(
    videoIds.map((id) => fetchCommentsForVideo(id, apiKey)),
  );

  const allComments = commentBatches
    .flat()
    .filter((c) => isRelevant(c.text, keywords))
    .sort((a, b) => b.likeCount - a.likeCount);

  return allComments.slice(0, limit).map(({ handle, text, url }) => ({ handle, text, url }));
}

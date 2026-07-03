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

// Only trims genuinely excessive outliers, and at a word boundary rather
// than an abrupt mid-sentence cut — most real comments are well under this.
function trimExcess(text: string, max = 600): string {
  const clean = text.trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return `${cut.slice(0, lastSpace > 0 ? lastSpace : max)}...`;
}

/** Self-promo/spam comments — a channel reposting their own video title
 *  with a link isn't a genuine community reaction, real account or not. */
function looksLikeSpam(text: string): boolean {
  return /https?:\/\/|www\.|youtu\.be/i.test(text);
}

/** Crude but effective English check: requires a couple common English
 *  function words and a low ratio of non-ASCII characters (catches
 *  Spanish/French/etc. accented text and non-Latin scripts alike). */
function looksEnglish(text: string): boolean {
  const lower = ` ${text.toLowerCase()} `;
  const commonWords = [" the ", " and ", " is ", " was ", " this ", " with ", " for ", " i ", " my ", " have ", " it ", " you ", " to "];
  const hits = commonWords.filter((w) => lower.includes(w)).length;
  const nonAsciiCount = (text.match(/[^\x00-\x7F]/g) ?? []).length;
  const nonAsciiRatio = nonAsciiCount / text.length;
  return hits >= 2 && nonAsciiRatio < 0.03;
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

/**
 * Selects which candidates should actually be shown, on two combined
 * conditions: (1) reads as someone sharing their OWN experience/opinion,
 * not just asking a question, and (2) is actually relevant to `topic` as
 * a *specific* claim — e.g. for "Jojoba Oil for Hair Growth", a real,
 * on-topic, genuine comment about using jojoba oil for acne or ingrown
 * hairs still isn't relevant to the hair-growth claim being evaluated,
 * even though it mentions the same ingredient. This only picks a subset
 * of REAL, already-fetched text — it never generates or rewrites anything.
 * Keyword/regex heuristics can't make either judgment reliably (a comment
 * about "ingrown hair" contains the word "hair" without being about hair
 * growth at all) — that takes actual reading comprehension. Fails open
 * (keeps everything) on any error so a Claude hiccup never empties out an
 * otherwise-good candidate pool.
 */
async function selectGenuineReactions<T extends { text: string }>(candidates: T[], topic: string): Promise<T[]> {
  if (candidates.length === 0) return candidates;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return candidates;

  const pool = candidates.slice(0, 15);
  const listText = pool.map((c, i) => `[${i}] "${c.text}"`).join("\n\n");

  const prompt = `Here are real YouTube comments found while researching "${topic}". Decide which ones should be KEPT, on two conditions that both must hold:

1. It reads as someone sharing their OWN experience, result, or opinion — not just asking a question, requesting advice, or asking for a comparison without sharing their own result. ("I switched from X to Y and it cleared up" = keep. "Sir which is better X or Y???" = exclude.)
2. It's actually relevant to "${topic}" as a SPECIFIC claim, not just mentioning the same general ingredient/practice for a different, unrelated purpose. (If the topic is "Jojoba Oil for Hair Growth", a real comment about using jojoba oil for acne or ingrown hairs is NOT relevant, even though it's genuine and mentions jojoba oil.)

${listText}

Return ONLY a JSON array of the indices to keep, e.g. [0,2,4]. No other text.`;

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
        max_tokens: 200,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!res.ok) return candidates;
    const json = (await res.json()) as { content: { text: string }[] };
    const text = json.content?.[0]?.text ?? "[]";
    const indices = JSON.parse(text.replace(/```json|```/g, "").trim()) as unknown;
    if (!Array.isArray(indices)) return candidates;

    const kept = indices
      .filter((i): i is number => typeof i === "number" && i >= 0 && i < pool.length)
      .map((i) => pool[i]);
    return kept.length > 0 ? kept : [];
  } catch {
    return candidates;
  }
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
        if (looksLikeSpam(text) || !looksEnglish(text)) return null;
        return {
          handle: author.startsWith("@") ? author : `@${author}`,
          text: trimExcess(text),
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

  if (allComments.length === 0) return [];

  const genuine = await selectGenuineReactions(allComments, query);

  return genuine.slice(0, limit).map(({ handle, text, url }) => ({ handle, text, url }));
}

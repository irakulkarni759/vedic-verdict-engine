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

  // Word-boundary fallback — a valid word boundary can still land right
  // after a short filler word ("...which seems like a..."), which reads as
  // an obviously broken dangling clause even though no word got chopped.
  // Walk back past trailing filler words too, so it ends on something more
  // substantial before the "...".
  const FILLER_WORDS = new Set([
    "a", "an", "the", "of", "to", "in", "on", "and", "or", "but",
    "is", "at", "as", "for", "with", "that", "this", "be", "so",
  ]);
  let cut = slice.lastIndexOf(" ");
  while (cut > 0) {
    const priorSpace = slice.lastIndexOf(" ", cut - 1);
    const word = slice.slice(priorSpace + 1, cut).toLowerCase().replace(/[^a-z]/g, "");
    if (!FILLER_WORDS.has(word)) break;
    cut = priorSpace;
  }
  return (cut > 0 ? slice.slice(0, cut) : slice) + "...";
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

/** Fire-and-forget wake ping for the sentiment backend. On a tight budget it
 *  runs with Railway app-sleeping ON (idle = free), so it cold-starts after
 *  inactivity. Pinging the moment someone shows intent to search — lands on
 *  the homepage, focuses the box — starts the container waking while they type,
 *  so it's warm by the time the verdict loader needs it, without paying to keep
 *  it up 24/7. Deliberately hits /api/claim/status (a trivial job lookup), NOT
 *  /api/claim, so it never triggers a scrape or a Claude call — waking has to
 *  stay cheap or it defeats the whole point. */
export const warmSentimentBackend = createServerFn({ method: "GET" }).handler(
  async (): Promise<null> => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4000);
    try {
      await fetch(`${SENTIMENT_API_URL}/api/claim/status?job_id=warmup`, {
        signal: controller.signal,
      });
    } catch {
      // Best-effort: a failed/slow ping just means the loader may hit a colder
      // backend, which the community fallback card already handles gracefully.
    } finally {
      clearTimeout(timeoutId);
    }
    return null;
  },
);

/** In-loader path: a single bounded attempt, awaited synchronously inside the
 *  main verdict generation so the scraped quotes land in the SAME render as the
 *  research — and, because the community summary is written FROM these quotes in
 *  the same pass, so does the correct summary. 20s is enough for a warm Railway
 *  scrape to finish; combined with running this in parallel with the PubMed
 *  fetch (see buildResultFromIds) the whole search stays within ~30s. Still
 *  bounded: if the scrape can't finish in time the fetch aborts, quotes come
 *  back [], and the summary + snapshot card fall back gracefully rather than
 *  hanging the request. Keeping Railway warm (prewarm ping) is what makes the
 *  scrape land inside this budget on the first search instead of only on a
 *  warm re-search. */
export async function fetchRedditQuotesFast(query: string, limit = 3): Promise<RedditQuote[]> {
  const res = await fetchOnce(query, 20000);
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
    return topQuotesToRedditQuotes(data.top_quotes, limit);
  } catch {
    return [];
  }
}

function topQuotesToRedditQuotes(topQuotes: SentimentApiTopQuote[] | undefined, limit: number): RedditQuote[] {
  if (!topQuotes || topQuotes.length === 0) return [];
  const quotes: RedditQuote[] = [];
  for (const c of topQuotes) {
    if (!c.body || !c.url) continue;
    quotes.push({
      handle: c.author ? `u/${c.author}` : `r/${c.subreddit ?? "reddit"}`,
      text: truncateAtWordBoundary(c.body, 600),
      url: c.url,
    });
    if (quotes.length >= limit) break;
  }
  return quotes;
}

/** Client-callable wrapper, used to live-fetch quotes for curated trends
 *  (which have no DB row to cache them in) at page-load time. */
export const getRedditQuotes = createServerFn({ method: "GET" })
  .inputValidator((d: { query: string }) => d)
  .handler(async ({ data }): Promise<RedditQuote[]> => fetchRedditQuotes(data.query));

/**
 * Async job pattern, used by the CLIENT-SIDE quote lookups (search page,
 * trend page) instead of one long-lived request. A single browser request
 * is at the mercy of whatever request-duration limit sits between it and
 * this app (e.g. Cloudflare Workers' limits) — that ceiling is shorter than
 * a slow, heavily-discussed claim's scrape can genuinely need. Polling
 * sidesteps that entirely: each individual poll is a fast, trivial lookup
 * that always returns quickly, while the actual scrape runs in the
 * background on Railway (a normal long-running server, not
 * duration-limited) for as long as it takes. The frontend can then keep
 * polling for as long as it wants without any single request ever timing
 * out — "keep trying" instead of "give up and say nothing found."
 */
export type ClaimJobStartResult =
  | { status: "done"; quotes: RedditQuote[] }
  | { status: "pending"; jobId: string }
  | { status: "error" };

export type ClaimJobPollResult =
  | { status: "done"; quotes: RedditQuote[] }
  | { status: "pending" }
  | { status: "error" };

async function startClaimJob(query: string, limit: number): Promise<ClaimJobStartResult> {
  try {
    const res = await fetch(`${SENTIMENT_API_URL}/api/claim/start?query=${encodeURIComponent(query)}`, {
      method: "POST",
    });
    if (!res.ok) return { status: "error" };
    const json = (await res.json()) as { status?: string; job_id?: string; top_quotes?: SentimentApiTopQuote[] };
    if (json.status === "done") return { status: "done", quotes: topQuotesToRedditQuotes(json.top_quotes, limit) };
    if (json.status === "pending" && json.job_id) return { status: "pending", jobId: json.job_id };
    return { status: "error" };
  } catch {
    return { status: "error" };
  }
}

async function pollClaimJob(jobId: string, limit: number): Promise<ClaimJobPollResult> {
  try {
    const res = await fetch(`${SENTIMENT_API_URL}/api/claim/status?job_id=${encodeURIComponent(jobId)}`);
    if (!res.ok) return { status: "error" };
    const json = (await res.json()) as { status?: string; top_quotes?: SentimentApiTopQuote[] };
    if (json.status === "done") return { status: "done", quotes: topQuotesToRedditQuotes(json.top_quotes, limit) };
    if (json.status === "pending") return { status: "pending" };
    return { status: "error" };
  } catch {
    return { status: "error" };
  }
}

/** Kicks off (or instantly resolves, on a cache hit) a claim lookup. */
export const startRedditQuoteJob = createServerFn({ method: "POST" })
  .inputValidator((d: { query: string }) => d)
  .handler(async ({ data }): Promise<ClaimJobStartResult> => startClaimJob(data.query, 3));

/** Checks in on a job started above. Cheap — safe to call every few seconds. */
export const pollRedditQuoteJob = createServerFn({ method: "GET" })
  .inputValidator((d: { jobId: string }) => d)
  .handler(async ({ data }): Promise<ClaimJobPollResult> => pollClaimJob(data.jobId, 3));

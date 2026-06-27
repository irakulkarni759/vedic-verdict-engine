// Replaces the notebook's `ddgs_text_safe()`. Originally written against
// Brave Search, but Brave's current pricing requires a card on file even
// though usage stays within the free monthly credit. Tavily has a genuinely
// free tier — 1,000 searches/month, no card required — and is purpose-built
// for this kind of AI-pipeline use case. Get a key at https://tavily.com
// (free signup, key shown directly on the dashboard).

export interface SearchResult {
  url: string;
  title: string;
  description?: string;
  rawContent?: string; // Tavily-extracted page text (include_raw_content)
}

function getTavilyKey(): string {
  const key = process.env.TAVILY_API_KEY;
  if (!key) {
    throw new Error(
      "TAVILY_API_KEY is not set. Add it as a server secret in your deployment settings.",
    );
  }
  return key;
}

interface TavilyResultItem {
  title: string;
  url: string;
  content?: string;
  raw_content?: string;
}

interface TavilySearchResponse {
  results?: TavilyResultItem[];
}

/**
 * Search the web via Tavily. Fails soft (returns []) on error — mirrors the
 * notebook's ddgs_text_safe, which surfaces failures via DEBUG logging
 * rather than throwing, since a single failed query shouldn't kill the
 * whole pipeline run.
 */
export async function tavilySearch(query: string, count = 6, retries = 2): Promise<SearchResult[]> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch("https://api.tavily.com/search", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${getTavilyKey()}`,
        },
        body: JSON.stringify({
          query,
          max_results: Math.min(count, 20),
          include_raw_content: true,
        }),
        signal: AbortSignal.timeout(15000),
      });

      if (res.status === 429 && attempt < retries) {
        await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
        continue;
      }
      if (!res.ok) return [];

      const json = (await res.json()) as TavilySearchResponse;
      const results = json.results ?? [];
      return results.map((r) => ({
        url: r.url,
        title: r.title,
        description: r.content,
        rawContent: r.raw_content,
      }));
    } catch {
      if (attempt === retries) return [];
      await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
    }
  }
  return [];
}

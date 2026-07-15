import { createServerFn } from "@tanstack/react-start";
import { getSupabaseServiceClient } from "./supabase.server";
import { CATEGORIES, type Trend, type Verdict } from "./trends";
import { checkAdminPassword } from "./comments.functions";
import { toTitleCase, coreSubjectForReddit } from "./utils";
import { fetchRedditQuotes } from "./reddit.server";
// Type-only — erased at compile time, so this doesn't create a runtime
// circular dependency even though evidence.functions.ts imports
// saveGeneratedTrend (a value) from this file.
import type { EvidenceBullet, EvidenceArticle, EvidenceVerdict, IngredientEvidence } from "./evidence.functions";

export const CATEGORY_SLUGS = CATEGORIES.map((c) => c.slug);

/** Turn a free-text search query into a URL-safe, stable id/slug. */
export function slugify(input: string): string {
  const base = input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return base || `query-${Date.now()}`;
}

/**
 * Cheap keyword fallback for category assignment, used only when we don't
 * have a Claude-derived category on hand (e.g. zero-PubMed-result queries,
 * where we never call Claude at all).
 */
export function guessCategoryFallback(query: string): string {
  const q = query.toLowerCase();
  if (/skin|spf|sunscreen|retinol|serum|acne|wrinkle/.test(q)) return "skincare";
  if (/hair|scalp|shampoo/.test(q)) return "haircare";
  if (/sleep|melatonin|insomnia/.test(q)) return "sleep";
  if (/gut|probiotic|digest|bloat/.test(q)) return "gut-health";
  if (/muscle|gym|workout|protein|creatine|exercise/.test(q)) return "fitness";
  if (/stress|anxiety|mood|mental|adaptogen/.test(q)) return "mental-wellness";
  if (/eat|diet|food|juice|fast/.test(q)) return "nutrition";
  return "supplements";
}

type GeneratedTrendRow = {
  id: string;
  query: string;
  name: string;
  category: string;
  verdict: "backed" | "mixed" | "debunked" | "unmapped";
  summary: string;
  community_verdict: string;
  safety_note: string;
  study_count: number;
  confidence: "low" | "moderate" | "high";
  last_updated: string;
  evidence_points: string[];
  sentiment_score: number;
  opinions: { handle: string; text: string; url: string }[];
  related_ids: string[];
  source_urls: string[];
  created_at: string;
  search_count: number;
  // Added for the full-result cache — nullable/defaulted since older rows
  // (written before this column existed) won't have them.
  bullets: EvidenceBullet[] | null;
  articles: EvidenceArticle[] | null;
  pubmed_search_url: string | null;
  reddit_search_url: string | null;
  generated_at: string | null;
  ingredient_fallback: string[] | null;
  ingredient_breakdown: IngredientEvidence[] | null;
  ingredient_source: { url: string | null; verified: boolean } | null;
  research_gist: string[] | null;
  community_gist: string[] | null;
};

export type SaveGeneratedTrendInput = {
  slug: string;
  query: string;
  name: string;
  category: string;
  verdict: "backed" | "mixed" | "debunked" | "unmapped";
  summary: string;
  communityVerdict: string;
  safetyNote: string;
  studyCount: number;
  confidence: "low" | "moderate" | "high";
  updated: string;
  evidencePoints: string[];
  sentiment: number;
  opinions: { handle: string; text: string; url: string }[];
  sourceUrls: string[];
  // Optional — only real (non-"unmapped") saves populate these, for the
  // full-result cache. Existing callers that only ever wrote the lossy
  // summary still work unchanged since these are optional.
  bullets?: EvidenceBullet[];
  articles?: EvidenceArticle[];
  pubmedSearchUrl?: string;
  redditSearchUrl?: string;
  generatedAt?: string;
  ingredientFallback?: string[] | null;
  ingredientBreakdown?: IngredientEvidence[] | null;
  ingredientSource?: { url: string | null; verified: boolean } | null;
  researchGist?: string[];
  communityGist?: string[];
};

/** Converts a DB row into the shared `Trend` shape so it can reuse TrendCard / TrendPage. */
function rowToTrend(row: GeneratedTrendRow): Trend | null {
  if (row.verdict === "unmapped") return null; // not a real verdict yet, don't surface as a card
  return {
    slug: row.id,
    name: row.name,
    query: row.query,
    category: row.category,
    verdict: row.verdict.toUpperCase() as Verdict,
    oneLiner: row.summary,
    researchGist: row.research_gist ?? undefined,
    communityVerdict: row.community_verdict ?? "",
    communityGist: row.community_gist ?? undefined,
    safetyNote: row.safety_note ?? "",
    studies: row.study_count,
    confidence: row.confidence,
    sentiment: row.sentiment_score,
    updated: row.last_updated,
    evidence: row.evidence_points ?? [],
    bullets: row.bullets && row.bullets.length > 0 ? row.bullets : undefined,
    quotes: row.opinions ?? [],
    related: row.related_ids ?? [],
    sourceUrls: row.source_urls ?? [],
    articles: row.articles && row.articles.length > 0 ? row.articles : undefined,
  };
}

/** Upsert a freshly-generated verdict. Safe to call even if Supabase isn't configured — fails silently. */
export const saveGeneratedTrend = createServerFn({ method: "POST" })
  .inputValidator((d: SaveGeneratedTrendInput) => d)
  .handler(async ({ data }) => {
    try {
      const supabase = getSupabaseServiceClient();

      // Read the current count first so a re-search of the same query adds
      // to it instead of resetting it — this is what "trending" is based on.
      const { data: existing } = await supabase
        .from("generated_trends")
        .select("search_count")
        .eq("id", data.slug)
        .maybeSingle();
      const searchCount = (existing?.search_count ?? 0) + 1;

      await supabase.from("generated_trends").upsert(
        {
          id: data.slug,
          query: data.query,
          name: data.name,
          category: data.category,
          verdict: data.verdict,
          summary: data.summary,
          community_verdict: data.communityVerdict,
          safety_note: data.safetyNote,
          study_count: data.studyCount,
          confidence: data.confidence,
          last_updated: data.updated,
          evidence_points: data.evidencePoints,
          sentiment_score: data.sentiment,
          opinions: data.opinions,
          related_ids: [],
          source_urls: data.sourceUrls,
          search_count: searchCount,
          bullets: data.bullets ?? [],
          articles: data.articles ?? [],
          pubmed_search_url: data.pubmedSearchUrl ?? "",
          reddit_search_url: data.redditSearchUrl ?? "",
          generated_at: data.generatedAt ?? new Date().toISOString(),
          ingredient_fallback: data.ingredientFallback ?? null,
          ingredient_breakdown: data.ingredientBreakdown ?? null,
          ingredient_source: data.ingredientSource ?? null,
          research_gist: data.researchGist ?? null,
          community_gist: data.communityGist ?? null,
        },
        { onConflict: "id" },
      );
      return { ok: true };
    } catch {
      // Supabase env vars missing, or a transient failure — don't block the search.
      return { ok: false };
    }
  });

export const getGeneratedTrendsByCategory = createServerFn({ method: "GET" })
  .inputValidator((d: { category: string }) => d)
  .handler(async ({ data }): Promise<Trend[]> => {
    try {
      const supabase = getSupabaseServiceClient();
      const { data: rows, error } = await supabase
        .from("generated_trends")
        .select("*")
        .eq("category", data.category)
        .neq("verdict", "unmapped")
        .order("created_at", { ascending: false })
        .limit(60);
      if (error || !rows) return [];
      return (rows as GeneratedTrendRow[])
        .map(rowToTrend)
        .filter((t): t is Trend => t !== null);
    } catch {
      return [];
    }
  });

export const getGeneratedTrendBySlug = createServerFn({ method: "GET" })
  .inputValidator((d: { slug: string }) => d)
  .handler(async ({ data }): Promise<Trend | null> => {
    try {
      const supabase = getSupabaseServiceClient();
      const { data: row, error } = await supabase
        .from("generated_trends")
        .select("*")
        .eq("id", data.slug)
        .maybeSingle();
      if (error || !row) return null;
      return rowToTrend(row as GeneratedTrendRow);
    } catch {
      return null;
    }
  });

/** Converts a DB row into the full EvidenceVerdict shape — everything
 *  search.$query.tsx needs, straight from the row, no regeneration. Only
 *  meaningful for rows written after the 0007 migration (bullets/articles
 *  columns); older rows return null so the caller falls through to a fresh
 *  generation instead of serving a broken/empty-looking cached page. */
function rowToEvidenceVerdict(row: GeneratedTrendRow): EvidenceVerdict | null {
  if (row.verdict === "unmapped") return null; // never serve a "we found nothing" row as a cache hit
  // Pre-migration rows (written before 0007) got backfilled with bullets/
  // articles = '[]' (NOT null — the migration's own DEFAULT), so `!row.bullets`
  // alone doesn't catch them: an empty array is truthy in JS. Checking length
  // instead correctly treats "no bullets" as "no rich data to serve" and
  // falls through to a real regeneration, regardless of what generated_at
  // claims (that got backfilled to the migration's run time, making every
  // old row look artificially fresh — this length check is what actually
  // keeps that from blocking a real regeneration for a full cache window).
  if (!row.bullets || row.bullets.length === 0 || !row.articles || !row.generated_at) return null;
  return {
    query: row.query,
    name: row.name,
    slug: row.id,
    category: row.category,
    verdict: row.verdict.toUpperCase() as EvidenceVerdict["verdict"],
    confidence: row.confidence,
    oneLiner: row.summary,
    researchGist: row.research_gist ?? [],
    communityVerdict: row.community_verdict ?? "",
    communityGist: row.community_gist ?? [],
    safetyNote: row.safety_note ?? "",
    studies: row.study_count,
    sentiment: row.sentiment_score,
    updated: row.last_updated,
    bullets: row.bullets,
    quotes: row.opinions ?? [],
    articles: row.articles,
    pubmedSearchUrl: row.pubmed_search_url || `https://pubmed.ncbi.nlm.nih.gov/?term=${encodeURIComponent(row.query)}`,
    redditSearchUrl: row.reddit_search_url || `https://www.reddit.com/search/?q=${encodeURIComponent(row.query)}`,
    generatedAt: row.generated_at,
    ingredientFallback: row.ingredient_fallback ?? null,
    ingredientBreakdown: row.ingredient_breakdown ?? null,
    ingredientSource: row.ingredient_source ?? null,
  };
}

/**
 * Cache read for a full evidence result, keyed by slug (same slug the
 * search page already uses). Returns null on a miss (never generated, or
 * generated before the full-cache migration) — the caller is responsible
 * for deciding freshness (via the returned generatedAt) and falling back
 * to a real generation either way.
 */
export const getGeneratedEvidenceBySlug = createServerFn({ method: "GET" })
  .inputValidator((d: { slug: string }) => d)
  .handler(async ({ data }): Promise<EvidenceVerdict | null> => {
    try {
      const supabase = getSupabaseServiceClient();
      const { data: row, error } = await supabase
        .from("generated_trends")
        .select("*")
        .eq("id", data.slug)
        .maybeSingle();
      if (error || !row) return null;
      return rowToEvidenceVerdict(row as GeneratedTrendRow);
    } catch {
      return null;
    }
  });

/**
 * Persist community quotes fetched live on the trend page back onto the
 * stored trend, so the slow Reddit fetch only ever happens once per trend
 * instead of on every visit. Only affects generated trends (rows keyed by
 * `id`); curated/hardcoded trends have no row, so this simply no-ops for
 * them. Fails silently, never blocks rendering.
 */
/**
 * Persist community quotes fetched live on the trend/search page back onto
 * the stored trend, so the slow Reddit fetch only ever happens once per
 * trend instead of on every visit. Only affects generated trends (rows
 * keyed by `id`); curated/hardcoded trends have no row, so this simply
 * no-ops for them.
 *
 * ALSO recomputes communityVerdict/sentiment from these specific quotes
 * (reusing the same logic as the admin quote-refresh backfill) and persists
 * that too, returning the fresh values to the caller. Just saving the
 * quotes without this meant a trend generated with zero quotes (a fast,
 * single-attempt fetch that missed a cold/slow scrape) kept its generic
 * "Limited public discussion" summary forever, even once real quotes were
 * found moments later on the same page — nothing ever told the summary to
 * catch up. Fails silently, never blocks rendering.
 */
export const persistTrendQuotes = createServerFn({ method: "POST" })
  .inputValidator(
    (d: {
      slug: string;
      name: string;
      summary: string;
      existingSentiment: number;
      quotes: { handle: string; text: string; url: string }[];
      /** Sentiment score (0-100) computed by the Reddit backend from the
       *  FULL scraped comment pool — when present it beats the Haiku guess
       *  from the 3 displayed quotes. Passed through from the claim job's
       *  payload by the pages that trigger the late re-fetch. */
      backendSentiment?: number | null;
    }) => d,
  )
  .handler(
    async ({
      data,
    }): Promise<{ ok: boolean; communityVerdict?: string; communityGist?: string[]; sentiment?: number }> => {
      try {
        if (!data.quotes || data.quotes.length === 0) return { ok: false };

        const { communityVerdict, communityGist, sentiment: inferredSentiment } = await inferSentimentFromQuotes({
          name: data.name,
          summary: data.summary,
          quotes: data.quotes,
          existingSentiment: data.existingSentiment,
        });

        const sentiment =
          typeof data.backendSentiment === "number" ? data.backendSentiment : inferredSentiment;

        const supabase = getSupabaseServiceClient();
        const update: Record<string, unknown> = { opinions: data.quotes };
        // This only ever runs when the page had zero quotes on hand (guarded
        // by callers), so any community_gist already on the row necessarily
        // predates these quotes and is now stale ("Limited discussion
        // found"). Replace it with the fresh quote-based gist so the hero
        // stays a skimmable bulleted list — nulling it (the old behavior)
        // demoted the section to one long sentence forever.
        if (communityVerdict) {
          update.community_verdict = communityVerdict;
          update.community_gist = communityGist.length > 0 ? communityGist : null;
        }
        if (typeof sentiment === "number") update.sentiment_score = sentiment;

        const { error } = await supabase.from("generated_trends").update(update).eq("id", data.slug);
        return {
          ok: !error,
          communityVerdict: communityVerdict ?? undefined,
          communityGist: communityGist.length > 0 ? communityGist : undefined,
          sentiment: sentiment ?? undefined,
        };
      } catch {
        return { ok: false };
      }
    },
  );

/**
 * Top searched-more-than-once queries, for the homepage "trying now" row.
 * Requires search_count >= 2 so it reflects genuine repeat interest rather
 * than just whatever was searched most recently.
 */
export const getTrendingSearches = createServerFn({ method: "GET" }).handler(
  async (): Promise<{ slug: string; name: string }[]> => {
    try {
      const supabase = getSupabaseServiceClient();
      const { data: rows } = await supabase
        .from("generated_trends")
        .select("id, name, search_count")
        .neq("verdict", "unmapped")
        .gte("search_count", 2)
        .order("search_count", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(6);
      return ((rows as { id: string; name: string; search_count: number }[]) ?? []).map((r) => ({
        slug: r.id,
        name: r.name,
      }));
    } catch {
      return [];
    }
  },
);

/** Total searched count + a handful of recent ones, for the homepage. */
export const getGeneratedTrendsMeta = createServerFn({ method: "GET" }).handler(
  async (): Promise<{ count: number; recent: Trend[] }> => {
    try {
      const supabase = getSupabaseServiceClient();
      const { count } = await supabase
        .from("generated_trends")
        .select("*", { count: "exact", head: true });

      const { data: rows } = await supabase
        .from("generated_trends")
        .select("*")
        .neq("verdict", "unmapped")
        .order("created_at", { ascending: false })
        .limit(12);

      return {
        count: count ?? 0,
        recent: ((rows as GeneratedTrendRow[]) ?? [])
          .map(rowToTrend)
          .filter((t): t is Trend => t !== null),
      };
    } catch {
      return { count: 0, recent: [] };
    }
  },
);

/**
 * One-off Claude call per row to turn a bare title (e.g. "Rosemary Oil")
 * into a standardized "X for Y" one (e.g. "Rosemary Oil for Hair Growth"),
 * inferring the purpose from the query/summary when the original search
 * didn't specify one. Used only by the admin backfill below.
 */
async function inferStandardizedName(row: {
  query: string;
  name: string;
  summary: string;
}): Promise<string | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  const prompt = `A wellness search result has this title: "${row.name}" (original search: "${row.query}"). Its summary: "${row.summary}"

Rewrite the title into the standardized form "X for Y" — X is the ingredient/product/practice, Y is the specific outcome or purpose it's evaluated for. If the title already states a purpose, just clean it up into this exact form (title case, no trailing punctuation). If it doesn't, infer the single most notable purpose from the summary and general knowledge — be specific (e.g. "for Hair Growth", not "for Health").

Return ONLY the new title text, nothing else — no quotes, no JSON, no explanation.`;

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
        max_tokens: 60,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    const json = (await res.json()) as { content: { text: string }[] };
    const text = (json.content?.[0]?.text ?? "").trim().replace(/^["']|["']$/g, "");
    if (!text || !/\bfor\b/i.test(text)) return null;
    return toTitleCase(text);
  } catch {
    return null;
  }
}

/**
 * Admin-only, one-time backfill: rewrites every stored trend's display name
 * into "X for Y" form. Skips rows whose name already contains " for " so
 * re-running this is safe/cheap. Password-gated the same way as comment
 * moderation.
 */
export const adminStandardizeTrendNames = createServerFn({ method: "POST" })
  .inputValidator((d: { password: string }) => d)
  .handler(
    async ({ data }): Promise<{ ok: boolean; updated?: number; skipped?: number; total?: number; error?: string }> => {
      if (!checkAdminPassword(data.password)) return { ok: false, error: "Wrong password." };

      try {
        const supabase = getSupabaseServiceClient();
        const { data: rows, error } = await supabase
          .from("generated_trends")
          .select("id, query, name, summary")
          .neq("verdict", "unmapped")
          .limit(500);
        if (error || !rows) return { ok: false, error: "Couldn't load trends." };

        let updated = 0;
        let skipped = 0;

        for (const row of rows as { id: string; query: string; name: string; summary: string }[]) {
          if (/\bfor\b/i.test(row.name)) {
            skipped++;
            continue;
          }
          const newName = await inferStandardizedName(row);
          if (!newName || newName === row.name) {
            skipped++;
            continue;
          }
          const { error: updateError } = await supabase
            .from("generated_trends")
            .update({ name: newName })
            .eq("id", row.id);
          if (updateError) {
            skipped++;
            continue;
          }
          updated++;
        }

        return { ok: true, updated, skipped, total: rows.length };
      } catch {
        return { ok: false, error: "Backfill failed partway through." };
      }
    },
  );

/**
 * One-off admin backfill for existing rows: moves any stored trend whose
 * query/name is about stress, anxiety, adaptogens, cortisol, calming, or
 * relaxation into the "mental-wellness" category, regardless of what
 * category it was originally saved under (usually "supplements", since the
 * category was picked based on the ingredient rather than the outcome —
 * see applyOutcomeCategoryOverride in evidence.functions.ts, which now
 * prevents this for NEW searches going forward). Pure regex, no Claude
 * calls needed. Safe to re-run — rows already in mental-wellness are
 * skipped.
 */
const STRESS_CATEGORY_PATTERN = /stress|anxiety|adaptogen|cortisol|calming|relaxation/i;

export const adminRecategorizeStressTrends = createServerFn({ method: "POST" })
  .inputValidator((d: { password: string }) => d)
  .handler(
    async ({ data }): Promise<{ ok: boolean; updated?: number; skipped?: number; total?: number; error?: string }> => {
      if (!checkAdminPassword(data.password)) return { ok: false, error: "Wrong password." };

      try {
        const supabase = getSupabaseServiceClient();
        const { data: rows, error } = await supabase
          .from("generated_trends")
          .select("id, query, name, category")
          .neq("verdict", "unmapped")
          .limit(500);
        if (error || !rows) return { ok: false, error: "Couldn't load trends." };

        let updated = 0;
        let skipped = 0;

        for (const row of rows as { id: string; query: string; name: string; category: string }[]) {
          const isStressRelated = STRESS_CATEGORY_PATTERN.test(row.query) || STRESS_CATEGORY_PATTERN.test(row.name);
          if (!isStressRelated || row.category === "mental-wellness") {
            skipped++;
            continue;
          }
          const { error: updateError } = await supabase
            .from("generated_trends")
            .update({ category: "mental-wellness" })
            .eq("id", row.id);
          if (updateError) {
            skipped++;
            continue;
          }
          updated++;
        }

        return { ok: true, updated, skipped, total: rows.length };
      } catch {
        return { ok: false, error: "Recategorize failed partway through." };
      }
    },
  );


/**
 * One-off Claude call per row to rewrite the templated summary sentence
 * ("Across N PubMed studies, the bulk of findings support X.") into an
 * actual analytical verdict, plus generate a community-sentiment verdict
 * sentence — using the row's own evidence points and opinions as context so
 * no new PubMed calls are needed. Used only by the admin backfill below.
 */
async function inferVerdictSummaries(row: {
  name: string;
  summary: string;
  evidencePoints: string[];
  opinions: { handle: string; text: string; url: string }[];
  sentiment: number;
}): Promise<{ researchVerdict: string | null; communityVerdict: string | null; safetyNote: string | null }> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { researchVerdict: null, communityVerdict: null, safetyNote: null };

  const evidenceText = row.evidencePoints.length
    ? row.evidencePoints.map((e) => `- ${e}`).join("\n")
    : "(no individual findings stored)";
  const opinionsText = row.opinions.length
    ? row.opinions.map((o) => `${o.handle}: "${o.text}"`).join("\n")
    : "(no community quotes stored)";

  const prompt = `A wellness result titled "${row.name}" currently has this generic summary: "${row.summary}"

Its stored findings:
${evidenceText}

Its stored community quotes (sentiment: ${row.sentiment}% positive):
${opinionsText}

Return a JSON object with three fields:
1. "researchVerdict": ONE sentence (max ~140 chars) giving the plain-language bottom line — write it the way you'd explain it to a friend, not a lab report. Avoid clinical/technical jargon and exact study durations/doses unless genuinely essential. State the real-world takeaway and one honest caveat if relevant. NOT a generic template like "Across N studies, findings support X" and NOT a dense academic sentence stuffed with numbers/mechanisms.
2. "communityVerdict": ONE sentence (max ~140 chars) in the same plain, conversational style — what people actually notice and talk about, not clinical terms. Base it on the quotes and sentiment score, not a literal quote.
3. "safetyNote": ONE short sentence (max ~140 chars) on the most common real safety consideration — drug interactions, pregnancy/breastfeeding warnings, allergy risk, or who should check with a doctor first. Base it on general medical knowledge for this ingredient/practice, in plain language. If there's genuinely nothing notable for typical healthy-adult use, return an empty string "" — don't invent a caution that doesn't apply.

Return ONLY this JSON, no other text:
{"researchVerdict": "...", "communityVerdict": "...", "safetyNote": "..."}`;

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
        max_tokens: 350,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    const json = (await res.json()) as { content: { text: string }[] };
    const text = json.content?.[0]?.text ?? "{}";
    const parsed = JSON.parse(text.replace(/```json|```/g, "").trim()) as {
      researchVerdict?: string;
      communityVerdict?: string;
      safetyNote?: string;
    };
    return {
      researchVerdict: typeof parsed.researchVerdict === "string" ? parsed.researchVerdict.trim() || null : null,
      communityVerdict: typeof parsed.communityVerdict === "string" ? parsed.communityVerdict.trim() || null : null,
      safetyNote: typeof parsed.safetyNote === "string" ? parsed.safetyNote.trim() : null,
    };
  } catch {
    return { researchVerdict: null, communityVerdict: null, safetyNote: null };
  }
}

/**
 * Admin-only backfill: rewrites the templated `summary` into a real
 * research verdict and fills in `community_verdict` for every stored
 * trend. Skips rows that already have a non-empty community_verdict unless
 * `force` is set, in which case every row is regenerated (e.g. after a
 * prompt-wording change, to re-run with the new phrasing). Password-gated
 * like comment moderation.
 */
export const adminBackfillVerdictSummaries = createServerFn({ method: "POST" })
  .inputValidator((d: { password: string; force?: boolean }) => d)
  .handler(
    async ({ data }): Promise<{ ok: boolean; updated?: number; skipped?: number; total?: number; error?: string }> => {
      if (!checkAdminPassword(data.password)) return { ok: false, error: "Wrong password." };

      try {
        const supabase = getSupabaseServiceClient();
        const { data: rows, error } = await supabase
          .from("generated_trends")
          .select("id, name, summary, community_verdict, evidence_points, opinions, sentiment_score")
          .neq("verdict", "unmapped")
          .limit(500);
        if (error || !rows) return { ok: false, error: "Couldn't load trends." };

        let updated = 0;
        let skipped = 0;

        for (const row of rows as {
          id: string; name: string; summary: string; community_verdict: string;
          evidence_points: string[]; opinions: { handle: string; text: string; url: string }[]; sentiment_score: number;
        }[]) {
          if (!data.force && row.community_verdict && row.community_verdict.trim()) {
            skipped++;
            continue;
          }
          const result = await inferVerdictSummaries({
            name: row.name,
            summary: row.summary,
            evidencePoints: row.evidence_points ?? [],
            opinions: row.opinions ?? [],
            sentiment: row.sentiment_score,
          });
          if (!result.communityVerdict) {
            skipped++;
            continue;
          }
          const { error: updateError } = await supabase
            .from("generated_trends")
            .update({
              summary: result.researchVerdict ?? row.summary,
              community_verdict: result.communityVerdict,
              safety_note: result.safetyNote ?? "",
            })
            .eq("id", row.id);
          if (updateError) {
            skipped++;
            continue;
          }
          updated++;
        }

        return { ok: true, updated, skipped, total: rows.length };
      } catch {
        return { ok: false, error: "Backfill failed partway through." };
      }
    },
  );

/**
 * Admin-only: replaces every stored trend's `opinions` (the fabricated
 * quotes from before real Reddit sourcing) with real Reddit comments,
 * re-searched using the trend's original `query`. Rows where no real
 * comments turn up get an empty array — never a fabricated fallback.
 * Always re-fetches (no skip condition), since the whole point is
 * replacing content that's currently fake. Password-gated like the
 * other admin actions.
 */
/**
 * Recomputes community_verdict and sentiment directly FROM a specific set
 * of real quotes — used after replacing a trend's quotes, so the sentiment
 * %/summary at the top of the card actually reflects what's now shown
 * instead of a stale value computed before the quotes changed. If there
 * are no real quotes, keeps the existing sentiment rather than guessing,
 * and returns a general (non-quote-based) community line.
 */
async function inferSentimentFromQuotes(row: {
  name: string;
  summary: string;
  quotes: { handle: string; text: string }[];
  existingSentiment: number;
}): Promise<{ communityVerdict: string | null; communityGist: string[]; sentiment: number | null }> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { communityVerdict: null, communityGist: [], sentiment: null };

  const quotesText = row.quotes.length
    ? row.quotes.map((q) => `${q.handle}: "${q.text}"`).join("\n")
    : "(no real quotes found for this trend)";

  const prompt = `A wellness result titled "${row.name}" has this research summary: "${row.summary}"

Real community quotes just fetched for it:
${quotesText}

Return a JSON object with three fields:
1. "sentiment": a number 0-100 for how positive community sentiment is, based ONLY on the real quotes above (if any) — not invented. If there are no real quotes, use your general knowledge of typical reception for this kind of product/practice instead.
2. "communityVerdict": ONE sentence (max ~140 chars), plain conversational language, synthesizing the real quotes above. Do not invent a specific claim the real quotes don't support. If there are no real quotes, write a general, honest line like "Limited public discussion found — the research above gives a reasonable starting expectation" rather than fabricating specifics.
3. "communityGist": 2-4 short phrases, EACH 2-3 WORDS MAX (skimmable fragments, not sentences — e.g. ["Mixed reviews", "Real results, slow", "Purging first weeks"]), capturing what the real quotes above actually say, ordered by how strongly/often they say it. Plain everyday words, no jargon. Base every phrase on the real quotes — never invent one. Empty array [] if there are no real quotes to summarize.

Return ONLY this JSON, no other text:
{"sentiment": 70, "communityVerdict": "...", "communityGist": ["...", "..."]}`;

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
        max_tokens: 350,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!res.ok) return { communityVerdict: null, communityGist: [], sentiment: null };
    const json = (await res.json()) as { content: { text: string }[] };
    const text = json.content?.[0]?.text ?? "{}";
    const parsed = JSON.parse(text.replace(/```json|```/g, "").trim()) as {
      sentiment?: number;
      communityVerdict?: string;
      communityGist?: string[];
    };
    // Same trim/cap treatment as generateBulletsAndQuotes' cleanGist — a
    // stray full-sentence "fragment" shouldn't blow up the hero layout.
    const communityGist = (parsed.communityGist ?? [])
      .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
      .map((s) => s.trim().slice(0, 40))
      .slice(0, 4);
    return {
      communityVerdict: typeof parsed.communityVerdict === "string" ? parsed.communityVerdict.trim() || null : null,
      communityGist,
      sentiment: typeof parsed.sentiment === "number" ? parsed.sentiment : null,
    };
  } catch {
    return { communityVerdict: null, communityGist: [], sentiment: null };
  }
}

const REFRESH_QUOTES_BATCH_SIZE = 5;

export const adminRefreshRedditQuotes = createServerFn({ method: "POST" })
  .inputValidator((d: { password: string; force?: boolean; cursor?: number }) => d)
  .handler(
    async ({
      data,
    }): Promise<{
      ok: boolean;
      updated?: number;
      emptied?: number;
      skipped?: number;
      processed?: number;
      batchTotal?: number;
      nextCursor?: number | null;
      quotaHit?: boolean;
      error?: string;
    }> => {
      if (!checkAdminPassword(data.password)) return { ok: false, error: "Wrong password." };

      try {
        const supabase = getSupabaseServiceClient();
        const { data: rows, error } = await supabase
          .from("generated_trends")
          .select("id, query, name, summary, sentiment_score, opinions")
          .neq("verdict", "unmapped")
          .order("id", { ascending: true })
          .limit(500);
        if (error || !rows) return { ok: false, error: "Couldn't load trends." };

        // Same target list every call (stable order by id) — a cursor into
        // this list is what lets the client resume a specific batch without
        // re-walking rows it already handled, and without one request ever
        // having to process everything in a single long-running loop.
        const targetRows = (
          rows as { id: string; query: string; name: string; summary: string; sentiment_score: number; opinions: unknown[] | null }[]
        ).filter((row) => data.force || !(Array.isArray(row.opinions) && row.opinions.length > 0));

        const cursor = data.cursor ?? 0;
        const batch = targetRows.slice(cursor, cursor + REFRESH_QUOTES_BATCH_SIZE);

        let updated = 0;
        let emptied = 0;
        let processed = 0;
        let quotaHit = false;

        for (const row of batch) {
          let realQuotes: { handle: string; text: string; url: string }[];
          try {
            realQuotes = await fetchRedditQuotes(coreSubjectForReddit(row.query));
          } catch {
            // fetchRedditQuotes already catches its own errors internally
            // and returns []; this is just a safety net.
            realQuotes = [];
          }
          processed++;

          const { communityVerdict, communityGist, sentiment } = await inferSentimentFromQuotes({
            name: row.name,
            summary: row.summary,
            quotes: realQuotes,
            existingSentiment: row.sentiment_score,
          });

          const { error: updateError } = await supabase
            .from("generated_trends")
            .update({
              opinions: realQuotes,
              community_verdict: communityVerdict ?? "",
              sentiment_score: sentiment ?? row.sentiment_score,
              // Same reasoning as persistTrendQuotes: real quotes just came
              // in, so any community_gist already on the row predates them —
              // replace it with the fresh quote-based gist (or clear it if
              // none came back) so it never shadows the new verdict.
              ...(realQuotes.length > 0
                ? { community_gist: communityGist.length > 0 ? communityGist : null }
                : {}),
            })
            .eq("id", row.id);
          if (updateError) continue;
          if (realQuotes.length > 0) updated++;
          else emptied++;
        }

        const nextCursor = cursor + batch.length;
        const skipped = rows.length - targetRows.length;

        return {
          ok: true,
          updated,
          emptied,
          skipped,
          processed,
          batchTotal: targetRows.length,
          nextCursor: nextCursor < targetRows.length ? nextCursor : null,
          quotaHit,
        };
      } catch {
        return { ok: false, error: "Refresh failed partway through." };
      }
    },
  );

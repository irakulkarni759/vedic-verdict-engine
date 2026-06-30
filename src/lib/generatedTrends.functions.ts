import { createServerFn } from "@tanstack/react-start";
import { getSupabaseServiceClient } from "./supabase.server";
import { CATEGORIES, type Trend, type Verdict } from "./trends";

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
  study_count: number;
  confidence: "low" | "moderate" | "high";
  last_updated: string;
  evidence_points: string[];
  sentiment_score: number;
  opinions: { handle: string; text: string }[];
  related_ids: string[];
  source_urls: string[];
  created_at: string;
};

export type SaveGeneratedTrendInput = {
  slug: string;
  query: string;
  name: string;
  category: string;
  verdict: "backed" | "mixed" | "debunked" | "unmapped";
  summary: string;
  studyCount: number;
  confidence: "low" | "moderate" | "high";
  updated: string;
  evidencePoints: string[];
  sentiment: number;
  opinions: { handle: string; text: string }[];
  sourceUrls: string[];
};

/** Converts a DB row into the shared `Trend` shape so it can reuse TrendCard / TrendPage. */
function rowToTrend(row: GeneratedTrendRow): Trend | null {
  if (row.verdict === "unmapped") return null; // not a real verdict yet, don't surface as a card
  return {
    slug: row.id,
    name: row.name,
    category: row.category,
    verdict: row.verdict.toUpperCase() as Verdict,
    oneLiner: row.summary,
    studies: row.study_count,
    confidence: row.confidence,
    sentiment: row.sentiment_score,
    updated: row.last_updated,
    evidence: row.evidence_points ?? [],
    quotes: row.opinions ?? [],
    related: row.related_ids ?? [],
  };
}

/** Upsert a freshly-generated verdict. Safe to call even if Supabase isn't configured — fails silently. */
export const saveGeneratedTrend = createServerFn({ method: "POST" })
  .inputValidator((d: SaveGeneratedTrendInput) => d)
  .handler(async ({ data }) => {
    try {
      const supabase = getSupabaseServiceClient();
      await supabase.from("generated_trends").upsert(
        {
          id: data.slug,
          query: data.query,
          name: data.name,
          category: data.category,
          verdict: data.verdict,
          summary: data.summary,
          study_count: data.studyCount,
          confidence: data.confidence,
          last_updated: data.updated,
          evidence_points: data.evidencePoints,
          sentiment_score: data.sentiment,
          opinions: data.opinions,
          related_ids: [],
          source_urls: data.sourceUrls,
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

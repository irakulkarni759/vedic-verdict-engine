import { createServerFn } from "@tanstack/react-start";
import { getSupabaseServiceClient } from "./supabase.server";
import { CATEGORIES, type Trend } from "@/data/trends";

// Row shape of the `generated_trends` table. Mirrors the mapping in
// verifyTrend.server.ts so the trend detail page can hydrate a generated
// trend that isn't in the static TRENDS array.
interface GeneratedTrendRow {
  id: string;
  name: string;
  category: string;
  verdict: string;
  summary: string;
  study_count: number;
  confidence: string;
  last_updated: string;
  evidence_points: string[];
  sentiment_score: number;
  opinions: { handle: string; text: string }[];
  related_ids: string[];
}

const CATEGORY_SLUGS = CATEGORIES.map((c) => c.slug);

function rowToTrend(row: GeneratedTrendRow): Trend {
  return {
    id: row.id,
    name: row.name,
    category: (CATEGORY_SLUGS.includes(row.category as Trend["category"])
      ? row.category
      : "supplements") as Trend["category"],
    verdict: row.verdict as Trend["verdict"],
    summary: row.summary,
    studyCount: row.study_count,
    confidence: row.confidence as Trend["confidence"],
    lastUpdated: row.last_updated,
    evidencePoints: row.evidence_points ?? [],
    sentimentScore: row.sentiment_score ?? 0,
    opinions: row.opinions ?? [],
    relatedIds: row.related_ids ?? [],
  };
}

// Look up a single generated trend by its id. Returns null when there's no
// matching row (the loader turns that into a notFound()).
export const getGeneratedTrend = createServerFn({ method: "GET" }).handler(
  async (ctx): Promise<Trend | null> => {
    const ctxData = ctx as unknown as { data: { id: unknown } };
    const id = String(ctxData.data?.id ?? "").trim();
    if (!id) return null;

    const supabase = getSupabaseServiceClient();
    const { data, error } = await supabase
      .from("generated_trends")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (error || !data) return null;
    return rowToTrend(data as GeneratedTrendRow);
  },
);
// Search generated trends by query text or name (for the search page, so a
// trend that's already been generated shows up as a normal result instead of
// being regenerated from scratch).
export const searchGeneratedTrends = createServerFn({ method: "GET" }).handler(
  async (ctx): Promise<Trend[]> => {
    const ctxData = ctx as unknown as { data: { q: unknown } };
    const q = String(ctxData.data?.q ?? "").trim();
    if (q.length < 2) return [];

    // Strip characters that would break PostgREST's or() filter syntax.
    const like = `%${q.replace(/[,()]/g, " ")}%`;
    const supabase = getSupabaseServiceClient();
    const { data, error } = await supabase
      .from("generated_trends")
      .select("*")
      .or(`query.ilike.${like},name.ilike.${like}`)
      .limit(20);

    if (error || !data) return [];
    return (data as GeneratedTrendRow[]).map(rowToTrend);
  },
);

// Live counts of generated trends, added to the static corpus stats on the
// home page so the "corpus" number reflects everything that's been generated.
export const getGeneratedCorpusStats = createServerFn({ method: "GET" }).handler(
  async (): Promise<{ total: number; backed: number; mixed: number; debunked: number }> => {
    const supabase = getSupabaseServiceClient();
    const { data, error } = await supabase.from("generated_trends").select("verdict");
    if (error || !data) return { total: 0, backed: 0, mixed: 0, debunked: 0 };

    const rows = data as { verdict: string }[];
    return {
      total: rows.length,
      backed: rows.filter((r) => r.verdict === "backed").length,
      mixed: rows.filter((r) => r.verdict === "mixed").length,
      debunked: rows.filter((r) => r.verdict === "debunked").length,
    };
  },
);
// Fetch all generated trends for a given category slug, for the category page.
export const getGeneratedTrendsByCategory = createServerFn({ method: "GET" }).handler(
  async (ctx): Promise<Trend[]> => {
    const ctxData = ctx as unknown as { data: { category: unknown } };
    const category = String(ctxData.data?.category ?? "").trim();
    if (!category) return [];

    const supabase = getSupabaseServiceClient();
    const { data, error } = await supabase
      .from("generated_trends")
      .select("*")
      .eq("category", category)
      .order("created_at", { ascending: false })
      .limit(50);

    if (error || !data) return [];
    return (data as GeneratedTrendRow[]).map(rowToTrend);
  },
);

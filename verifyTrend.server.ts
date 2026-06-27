import { createServerFn } from "@tanstack/react-start";
import type { CategorySlug, Trend } from "@/data/trends";
import { getSupabaseServiceClient } from "./supabase.server";
import { autoExtractProductInfo } from "./pipeline/productInfo.server";
import { analyzeCommunitySentiment, type SentimentResult } from "./pipeline/sentiment.server";
import { runPubmedLayers } from "./pipeline/pubmed.server";
import { summarizeVedaResult } from "./pipeline/synthesize.server";
import { sentimentToScore, toConfidence, toUiVerdict } from "./pipeline/verdictMapping";

// Ported from run_veda() in the notebook — this is the equivalent top-level
// orchestrator, exposed as a TanStack Start server function so the frontend
// can call it directly (it compiles to an RPC call, no separate API route
// needed).

const CATEGORY_SLUGS: CategorySlug[] = [
  "skincare",
  "haircare",
  "supplements",
  "nutrition",
  "fitness",
  "sleep",
  "gut-health",
  "mental-wellness",
];

function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "trend"
  );
}

// Mirrors the shape of the `generated_trends` table (see
// supabase/migrations/0001_generated_trends.sql). snake_case to match
// Postgres convention; mapped to/from the camelCase Trend type at the edges.
interface GeneratedTrendRow {
  id: string;
  query: string;
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
  source_urls: string[];
}

function rowToTrend(row: GeneratedTrendRow): Trend {
  return {
    id: row.id,
    name: row.name,
    category: (CATEGORY_SLUGS.includes(row.category as CategorySlug)
      ? row.category
      : "supplements") as CategorySlug,
    verdict: row.verdict as Trend["verdict"],
    summary: row.summary,
    studyCount: row.study_count,
    confidence: row.confidence as Trend["confidence"],
    lastUpdated: row.last_updated,
    evidencePoints: row.evidence_points,
    sentimentScore: row.sentiment_score,
    opinions: row.opinions,
    relatedIds: row.related_ids,
  };
}

// Claude gives us subject_type but not a Veda category — keyword-match as a
// v1 guess. Worth revisiting with a dedicated Claude call if misclassification
// turns out to be common in practice.
function guessCategory(subject: string, claim: string): CategorySlug {
  const t = `${subject} ${claim}`.toLowerCase();
  const rules: [CategorySlug, string[]][] = [
    ["skincare", ["skin", "spf", "sunscreen", "retinol", "serum", "acne", "wrinkle", "collagen"]],
    ["haircare", ["hair", "scalp"]],
    [
      "supplements",
      ["supplement", "vitamin", "magnesium", "ashwagandha", "creatine", "powder", "capsule"],
    ],
    ["nutrition", ["diet", "fasting", "food", "juice", "nutrition", "eating"]],
    ["fitness", ["exercise", "training", "muscle", "workout", "performance"]],
    ["sleep", ["sleep", "insomnia", "melatonin"]],
    ["gut-health", ["gut", "microbiome", "probiotic", "digestion"]],
    ["mental-wellness", ["stress", "anxiety", "mood", "cortisol", "mental", "meditation"]],
  ];
  for (const [slug, keywords] of rules) {
    if (keywords.some((k) => t.includes(k))) return slug;
  }
  return "supplements";
}

const verifyTrendInput = (query: unknown): string => {
  if (typeof query !== "string" || query.trim().length < 2 || query.trim().length > 120) {
    throw new Error("Query must be between 2 and 120 characters.");
  }
  return query.trim();
};

export const verifyTrend = createServerFn({ method: "POST" }).handler(
  async (ctx): Promise<Trend> => {
    const ctxData = ctx as unknown as { data: { query: unknown } };
    const query = verifyTrendInput(ctxData.data?.query);
    const normalized = query.toLowerCase();
    const supabase = getSupabaseServiceClient();

    // 1. Cache check — never re-run the pipeline for a query already generated.
    const { data: cached } = await supabase
      .from("generated_trends")
      .select("*")
      .eq("query", normalized)
      .maybeSingle();

    if (cached) return rowToTrend(cached as GeneratedTrendRow);

    // 2. Run the pipeline.
    const productInfo = await autoExtractProductInfo(query);

    let sentiment: SentimentResult | null = null;
    try {
      sentiment = await analyzeCommunitySentiment(query);
    } catch {
      // Sentiment is supplementary — a failure here shouldn't sink the whole
      // verdict. Mirrors the notebook's try/except around this same call.
      sentiment = null;
    }

    const layers = await runPubmedLayers({
      subject: productInfo.subject || query,
      claim: productInfo.claim || query,
      mechanisms: productInfo.mechanisms,
      ingredients: productInfo.ingredients,
    });

    const synthesis = await summarizeVedaResult(query, productInfo, layers, sentiment);

    const studyCount = layers.reduce((sum, l) => sum + l.papers.length, 0);
    const name = productInfo.subject || query;

    const row: GeneratedTrendRow = {
      id: `${slugify(name)}-${Date.now().toString(36)}`,
      query: normalized,
      name,
      category: guessCategory(productInfo.subject, productInfo.claim),
      verdict: toUiVerdict(synthesis.researchVerdict),
      summary: synthesis.bottomLine || synthesis.researchSummary.slice(0, 240),
      study_count: studyCount,
      confidence: toConfidence(synthesis.researchVerdict),
      last_updated: new Date().toISOString().slice(0, 10),
      evidence_points: synthesis.evidencePoints,
      sentiment_score: sentiment ? sentimentToScore(sentiment.overall) : 0,
      opinions: sentiment
        ? sentiment.quotes.slice(0, 3).map((text, i) => ({
            handle: sentiment?.source_urls[i]?.includes("reddit.com") ? "r/community" : "Community",
            text,
          }))
        : [],
      related_ids: [],
      source_urls: productInfo.source_urls,
    };

    // 3. Persist for next time. A write failure shouldn't block returning the
    // result the user is waiting on — log and move on.
    const { error } = await supabase.from("generated_trends").upsert(row, { onConflict: "id" });
    if (error) {
      console.error("Failed to persist generated trend:", error);
    }

    return rowToTrend(row);
  },
);

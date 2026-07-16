import { createServerFn } from "@tanstack/react-start";
import { getSupabaseServiceClient } from "./supabase.server";
import { trendBySlug } from "./trends";
import {
  PROFILE_QUESTIONS,
  sanitizeProfile,
  profileToLines,
  canonicalProfileString,
  type Profile,
} from "./profile";

// The personalized "FOR YOU" line: one small Haiku call on top of the
// already-cached verdict, keyed on (trend_slug, profile_hash) so identical
// questionnaire answers share a single generation per trend. The profile
// itself never touches the database — only its hash does. An empty line is
// a legitimate cached outcome ("your profile doesn't change this verdict"),
// so irrelevant trend/profile pairs cost exactly one LLM call ever.

export type PersonalizedLine = {
  ok: boolean;
  /** The one-sentence personalized take. Empty string = profile doesn't
   *  change anything for this trend (a real answer, not a failure). */
  line: string;
  /** Question ids (e.g. "climate", "skinType") that drove the line. */
  basedOn: string[];
};

const FAILED: PersonalizedLine = { ok: false, line: "", basedOn: [] };

/** Trend fields the prompt needs. Client may pass this as a fallback for
 *  freshly-generated trends that haven't landed in generated_trends yet. */
type TrendContext = {
  name: string;
  verdict: string;
  oneLiner: string;
  safetyNote: string;
  category: string;
};

async function hashProfile(canonical: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function cleanContext(ctx: Partial<TrendContext> | undefined): TrendContext | null {
  if (!ctx) return null;
  const s = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const name = s(ctx.name, 120);
  const verdict = s(ctx.verdict, 20).toUpperCase();
  if (!name || !verdict) return null;
  return {
    name,
    verdict,
    oneLiner: s(ctx.oneLiner, 300),
    safetyNote: s(ctx.safetyNote, 300),
    category: s(ctx.category, 40),
  };
}

/** Server-side trend lookup: curated list first, then generated_trends. */
async function lookupTrendContext(slug: string): Promise<TrendContext | null> {
  const curated = trendBySlug(slug);
  if (curated) {
    return {
      name: curated.name,
      verdict: curated.verdict,
      oneLiner: curated.oneLiner,
      safetyNote: curated.safetyNote,
      category: curated.category,
    };
  }
  try {
    const supabase = getSupabaseServiceClient();
    const { data: row, error } = await supabase
      .from("generated_trends")
      .select("name, verdict, summary, safety_note, category")
      .eq("id", slug)
      .maybeSingle();
    if (error || !row || row.verdict === "unmapped") return null;
    return {
      name: row.name,
      verdict: String(row.verdict).toUpperCase(),
      oneLiner: row.summary ?? "",
      safetyNote: row.safety_note ?? "",
      category: row.category ?? "",
    };
  } catch {
    return null;
  }
}

async function generateLine(
  trend: TrendContext,
  profile: Profile,
  apiKey: string,
): Promise<{ line: string; basedOn: string[] } | null> {
  const validIds = PROFILE_QUESTIONS.map((q) => q.id);

  const prompt = `You write ONE optional personalization sentence for a wellness fact-check site called Veda. A visitor is looking at this trend's verdict page:

Trend: "${trend.name}" (category: ${trend.category || "unknown"})
Overall verdict: ${trend.verdict}
Research summary: ${trend.oneLiner || "n/a"}
Safety note: ${trend.safetyNote || "none"}

The visitor's self-reported profile:
${profileToLines(profile).join("\n")}

Your job: decide whether anything in THIS profile genuinely changes how THIS person should think about THIS trend — fit, texture, climate suitability, diet conflict (e.g. collagen isn't vegan), relevance to their gut/sleep/skin/hair situation, or a safety consideration (e.g. pregnancy). If yes, write ONE sentence about the single most useful such consideration. If nothing applies beyond what's true for everyone, return an empty line — do NOT invent a connection.

Rules for the sentence:
- ONE sentence, max ~140 characters, plain everyday words a 12-year-old gets instantly. No jargon.
- Frame as a consideration ("might", "worth knowing", "can feel"), NEVER as medical advice, a diagnosis, or an instruction to start/stop anything.
- Never claim the product/practice will or won't work for them — only how their situation changes the picture.
- If they are pregnant/breastfeeding AND the trend has a real pregnancy-relevant concern, that outranks everything else.
- Do not mention Veda, the verdict word, or restate the research summary.
- Do not address attributes not in their profile.

Return ONLY this JSON, no other text:
{"line": "…or empty string…", "basedOn": ["questionId", …]}

"basedOn" lists which profile question ids (from: ${validIds.join(", ")}) actually drove the line — empty array if line is empty.`;

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
        max_tokens: 300,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    const json = (await res.json()) as { content: { text: string }[] };
    const text = json.content?.[0]?.text ?? "{}";
    const parsed = JSON.parse(text.replace(/```json|```/g, "").trim()) as {
      line?: string;
      basedOn?: string[];
    };

    const line = typeof parsed.line === "string" ? parsed.line.trim().slice(0, 220) : "";
    const basedOn = line
      ? (parsed.basedOn ?? []).filter(
          (id): id is string => typeof id === "string" && validIds.includes(id),
        )
      : [];
    return { line, basedOn };
  } catch {
    return null;
  }
}

export const getPersonalizedLine = createServerFn({ method: "POST" })
  .inputValidator((d: { slug: string; profile: Profile; context?: Partial<TrendContext> }) => d)
  .handler(async ({ data }): Promise<PersonalizedLine> => {
    const slug = typeof data.slug === "string" ? data.slug.trim().slice(0, 200) : "";
    if (!slug) return FAILED;

    // Strict enum validation — free-form values never reach the prompt or
    // the cache key.
    const profile = sanitizeProfile(data.profile ?? {});
    if (Object.keys(profile).length === 0) return FAILED;

    const profileHash = await hashProfile(canonicalProfileString(profile));

    let supabase: ReturnType<typeof getSupabaseServiceClient> | null = null;
    try {
      supabase = getSupabaseServiceClient();
    } catch {
      supabase = null; // no DB configured — still works, just uncached
    }

    if (supabase) {
      try {
        const { data: row } = await supabase
          .from("personalized_verdicts")
          .select("line, based_on")
          .eq("trend_slug", slug)
          .eq("profile_hash", profileHash)
          .maybeSingle();
        if (row) {
          return { ok: true, line: row.line ?? "", basedOn: row.based_on ?? [] };
        }
      } catch {
        // cache read failed — fall through to a fresh generation
      }
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return FAILED;

    // Server-side lookup first; the client-provided context only covers the
    // window where a freshly-searched trend hasn't been persisted yet.
    const trend = (await lookupTrendContext(slug)) ?? cleanContext(data.context);
    if (!trend) return FAILED;

    const result = await generateLine(trend, profile, apiKey);
    if (!result) return FAILED;

    if (supabase) {
      try {
        await supabase.from("personalized_verdicts").upsert(
          {
            trend_slug: slug,
            profile_hash: profileHash,
            line: result.line,
            based_on: result.basedOn,
          },
          { onConflict: "trend_slug,profile_hash" },
        );
      } catch {
        // cache write failed — the line still gets returned, just regenerated next time
      }
    }

    return { ok: true, line: result.line, basedOn: result.basedOn };
  });

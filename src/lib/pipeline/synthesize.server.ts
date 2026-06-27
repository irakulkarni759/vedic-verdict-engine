import { askClaude, parseClaudeJson } from "./anthropic.server";
import type { ProductInfo } from "./productInfo.server";
import type { EvidenceLayer } from "./pubmed.server";
import type { SentimentResult } from "./sentiment.server";

// Adapted from summarize_veda_result() in the notebook. The original asked
// Claude for a ===BOTTOM_LINE===/===RESEARCH=== prose block meant for
// console printing, then parsed it back apart with string splits. Since this
// version needs to populate a typed UI (Trend.summary, Trend.evidencePoints,
// etc.), it asks Claude for the same content as strict JSON instead — same
// rules, same neutrality requirements, cleaner output contract.

export type ResearchVerdict = "Strong" | "Moderate" | "Mixed" | "Limited" | "Not supported";

export interface SynthesisResult {
  researchVerdict: ResearchVerdict;
  bottomLine: string;
  researchSummary: string;
  evidencePoints: string[];
  mostRelevantStudies: { title: string; year: string }[];
}

interface RawSynthesis {
  verdict?: string;
  bottom_line?: string;
  research_summary?: string;
  evidence_points?: string[];
  most_relevant_studies?: { title?: string; year?: string }[];
}

const VALID_VERDICTS: ResearchVerdict[] = [
  "Strong",
  "Moderate",
  "Mixed",
  "Limited",
  "Not supported",
];

export async function summarizeVedaResult(
  userQuery: string,
  productInfo: ProductInfo,
  layers: EvidenceLayer[],
  sentiment: SentimentResult | null,
): Promise<SynthesisResult> {
  const allPapers = layers.flatMap((l) => l.papers.map((p) => ({ ...p, evidence_layer: l.label })));

  const layerSummary =
    layers
      .map((l) => `- ${l.label}: ${l.total_matches} matches, ${l.papers.length} abstracts reviewed`)
      .join("\n") || "No evidence layers were applicable.";

  const papersText = allPapers
    .slice(0, 25)
    .map(
      (p) =>
        `[${p.evidence_layer}] ${p.title} (${p.year}, ${p.journal}; ${p.publication_types.join(", ")})\n${p.abstract}`,
    )
    .join("\n\n");

  const subjectType = productInfo.subject_type === "practice" ? "practice" : "product";
  const subject = productInfo.subject || userQuery;
  const claim = productInfo.claim || userQuery;

  const sentCtx = sentiment
    ? `Overall community vibe: ${sentiment.overall}. Liked: ${JSON.stringify(
        sentiment.positive_themes,
      )}. Complaints: ${JSON.stringify(sentiment.negative_themes)}. Reliability: ${sentiment.notes}`
    : "No community sentiment available.";

  const prompt = `You are Veda, an evidence reviewer for wellness products AND practices.
The subject here is a ${subjectType}: "${subject}". Do not use product/brand/ingredient
language if it is a practice.

What is being evaluated (state neutrally, do NOT attribute to a brand):
${claim}

Evidence layers that ran:
${layerSummary}

PubMed abstracts:
${papersText || "No abstracts found."}

Community sentiment context:
${sentCtx}

Return valid JSON only, no preamble, no markdown fences:
{
  "verdict": "Strong / Moderate / Mixed / Limited / Not supported",
  "bottom_line": "2-3 sentences combining BOTH what the research shows AND what the community thinks. Plain language, leads with the verdict, notes whether community experience aligns or diverges.",
  "research_summary": "3-5 sentences explaining the evidence. Reference only layers that produced results, by name. Note study types/quality where relevant. Be honest about gaps, but do NOT say 'no research exists' if abstracts were found. If the subject is a practice with no product-level trials, that is normal - judge it on direct + mechanism evidence, not on the absence of 'product' studies.",
  "evidence_points": ["3-5 short, specific evidence bullet points drawn only from the abstracts above"],
  "most_relevant_studies": [{"title": "...", "year": "..."}]
}

Rules:
- Neutral framing: evaluate whether ${subject} produces the effect, not "brand claims".
- Do not fabricate citations, studies, or evidence points not grounded in the abstracts above.
- Consumer-friendly but scientifically careful.
- most_relevant_studies: list up to 5 actual studies from the abstracts (title + year). Empty array if none.
- evidence_points should be self-contained sentences a reader can scan without the rest of the report.`;

  const raw = await askClaude(prompt, 1300);
  const parsed = parseClaudeJson<RawSynthesis>(raw);

  if (!parsed) {
    return {
      researchVerdict: "Limited",
      bottomLine:
        "Evidence synthesis could not be completed for this query — try again in a moment.",
      researchSummary: raw.slice(0, 500),
      evidencePoints: [],
      mostRelevantStudies: [],
    };
  }

  const verdict = VALID_VERDICTS.includes(parsed.verdict as ResearchVerdict)
    ? (parsed.verdict as ResearchVerdict)
    : "Limited";

  return {
    researchVerdict: verdict,
    bottomLine: parsed.bottom_line ?? "",
    researchSummary: parsed.research_summary ?? "",
    evidencePoints: parsed.evidence_points ?? [],
    mostRelevantStudies: (parsed.most_relevant_studies ?? [])
      .filter((s): s is { title: string; year: string } => Boolean(s.title))
      .map((s) => ({ title: s.title, year: s.year ?? "" })),
  };
}

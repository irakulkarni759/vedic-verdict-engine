import type { Verdict } from "@/data/trends";
import type { ResearchVerdict } from "./synthesize.server";

// This mapping is a PRODUCT DECISION, made here explicitly rather than left
// implicit in a prompt. The research pipeline naturally produces a 5-bucket
// verdict (Strong/Moderate/Mixed/Limited/Not supported) but the UI only has
// 4 buckets (backed/mixed/debunked/unmapped). Adjust this if the mapping
// feels wrong in practice — e.g. you may want "Limited" to lean toward
// "debunked" instead of "mixed" once you see real generated results.
export function toUiVerdict(v: ResearchVerdict): Verdict {
  switch (v) {
    case "Strong":
    case "Moderate":
      return "backed";
    case "Mixed":
    case "Limited":
      return "mixed";
    case "Not supported":
      return "debunked";
    default:
      return "unmapped";
  }
}

export function toConfidence(v: ResearchVerdict): "low" | "moderate" | "high" {
  switch (v) {
    case "Strong":
      return "high";
    case "Moderate":
    case "Mixed":
    case "Not supported":
      return "moderate";
    case "Limited":
    default:
      return "low";
  }
}

/** Maps the sentiment layer's categorical "overall" read onto the -1..1
 * sentimentScore the Trend interface expects. */
export function sentimentToScore(overall: string): number {
  switch (overall) {
    case "positive":
      return 0.75;
    case "mostly positive":
      return 0.4;
    case "mixed":
      return 0;
    case "mostly negative":
      return -0.4;
    case "negative":
      return -0.75;
    default:
      return 0;
  }
}

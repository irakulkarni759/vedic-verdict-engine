import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const TITLE_CASE_MINOR_WORDS = new Set([
  "a", "an", "the", "and", "but", "or", "nor", "for", "so", "yet",
  "as", "at", "by", "in", "of", "on", "to", "up", "via", "vs", "with", "from",
]);

/**
 * Normalizes free-text input ("vitamin c for dark spots") into display
 * title case ("Vitamin C for Dark Spots"). Minor words (articles,
 * prepositions, conjunctions) stay lowercase unless they're first/last.
 * Hyphenated words get each segment capitalized.
 */
export function toTitleCase(input: string): string {
  const words = input.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "";
  return words
    .map((word, i) => {
      if (i !== 0 && i !== words.length - 1 && TITLE_CASE_MINOR_WORDS.has(word)) {
        return word;
      }
      return word
        .split("-")
        .map((part) => (part.length ? part[0].toUpperCase() + part.slice(1) : part))
        .join("-");
    })
    .join(" ");
}

/**
 * Repeatedly calls `poll` every `intervalMs` until it stops reporting
 * pending (per `isPending`) or `maxAttempts` is hit. Returns the final
 * result either way. Used for the Reddit-quote job polling: rather than one
 * long-lived request (which is at the mercy of whatever request-duration
 * limit sits in front of the backend), each poll is a fast, trivial check,
 * so the actual background work can take as long as it genuinely needs
 * without anything timing out.
 */
export async function pollUntil<T>(
  poll: () => Promise<T>,
  isPending: (result: T) => boolean,
  opts: { intervalMs: number; maxAttempts: number; isCancelled: () => boolean },
): Promise<T> {
  let result = await poll();
  let attempts = 1;
  while (isPending(result) && attempts < opts.maxAttempts && !opts.isCancelled()) {
    await new Promise((resolve) => setTimeout(resolve, opts.intervalMs));
    if (opts.isCancelled()) break;
    result = await poll();
    attempts++;
  }
  return result;
}

/**
 * Strips a trailing " for <purpose>" clause before searching Reddit — people
 * discuss "stomach vacuum," not "stomach vacuum for shrinking waist," so the
 * purpose clause only dilutes the search and can cost real matches. Leaves
 * the query unchanged if it has no " for " clause (or one right at the
 * start, which isn't a purpose clause to strip).
 */
export function coreSubjectForReddit(query: string): string {
  const idx = query.toLowerCase().indexOf(" for ");
  if (idx <= 0) return query.trim();
  const core = query.slice(0, idx).trim();
  return core || query.trim();
}

/**
 * The complement of coreSubjectForReddit — extracts what comes AFTER " for "
 * instead of before it. Used to keep a search outcome-aware when a query
 * gets broken down into its component ingredient/compound names (e.g. for
 * a branded product's per-ingredient PubMed searches): "ursolic acid"
 * alone pulls in completely unrelated research (antiparasitic activity,
 * drug metabolism) that happens to also study ursolic acid, whereas
 * "ursolic acid hair growth" stays anchored to the actual claim. Returns
 * null if there's no " for " clause to extract.
 */
export function outcomeClause(query: string): string | null {
  const idx = query.toLowerCase().indexOf(" for ");
  if (idx <= 0) return null;
  const outcome = query.slice(idx + 5).trim();
  return outcome || null;
}

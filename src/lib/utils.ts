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
 * Races a promise against a timeout, resolving to `fallback` if the promise
 * hasn't settled in time. Used to put a hard ceiling on client-side fetches
 * to slow/cold backends (e.g. the Reddit sentiment service) — without this,
 * an unusually slow response (or an underlying network/runtime hang that
 * never cleanly rejects) can leave a "loading" state on screen indefinitely,
 * since there's nothing else to flip it to a resolved state.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        resolve(fallback);
      }
    }, ms);
    promise.then(
      (value) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve(value);
        }
      },
      () => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve(fallback);
        }
      },
    );
  });
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

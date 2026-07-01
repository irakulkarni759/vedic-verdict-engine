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

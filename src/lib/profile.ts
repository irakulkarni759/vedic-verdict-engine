// Wellness profile: the ~10 multiple-choice questions behind the "FOR YOU"
// personalized verdict line. Everything here is client-safe (no server
// imports) — the questionnaire UI renders from QUESTIONS, and the
// personalize server function imports the same schema to validate answers,
// so the two can never drift apart.
//
// Answers live ONLY in localStorage for now (no accounts, no server-side
// profile storage) — the profile is sent per-request when asking for a
// personalized line, and the server stores just a one-way hash of it as a
// cache key. Keep every question coarse multiple-choice: no free text, both
// so answers can be strictly validated server-side and so we never hold
// anything more sensitive than a bucket label.

export type ProfileQuestion = {
  id: string;
  /** Short label used in prompts and the profile page ("Skin type"). */
  label: string;
  /** The question as asked on the questionnaire page. */
  prompt: string;
  options: { value: string; label: string }[];
  /** Multi-select (chips toggle independently); single-select otherwise. */
  multi?: boolean;
};

export const PROFILE_QUESTIONS: ProfileQuestion[] = [
  {
    id: "goal",
    label: "Main wellness goal",
    prompt: "What are you mainly here to improve?",
    options: [
      { value: "skin", label: "Better skin" },
      { value: "hair", label: "Hair health" },
      { value: "gut", label: "Gut health" },
      { value: "sleep", label: "Better sleep" },
      { value: "energy", label: "Energy & focus" },
      { value: "fitness", label: "Fitness & recovery" },
    ],
  },
  {
    id: "skinType",
    label: "Skin type",
    prompt: "How would you describe your skin?",
    options: [
      { value: "oily", label: "Oily" },
      { value: "dry", label: "Dry" },
      { value: "combination", label: "Combination" },
      { value: "sensitive", label: "Sensitive" },
      { value: "normal", label: "Normal" },
    ],
  },
  {
    id: "hairType",
    label: "Hair type",
    prompt: "What's your hair like?",
    options: [
      { value: "straight", label: "Straight" },
      { value: "wavy", label: "Wavy" },
      { value: "curly", label: "Curly" },
      { value: "coily", label: "Coily" },
      { value: "little-none", label: "Little / none" },
    ],
  },
  {
    id: "climate",
    label: "Climate",
    prompt: "What climate do you live in?",
    options: [
      { value: "hot-humid", label: "Hot & humid" },
      { value: "hot-dry", label: "Hot & dry" },
      { value: "temperate", label: "Temperate" },
      { value: "cold", label: "Cold" },
    ],
  },
  {
    id: "gutIssues",
    label: "Gut issues",
    prompt: "Any recurring gut issues? Pick all that apply.",
    multi: true,
    options: [
      { value: "none", label: "None" },
      { value: "bloating", label: "Bloating" },
      { value: "reflux", label: "Acid reflux" },
      { value: "constipation", label: "Constipation" },
      { value: "ibs-like", label: "IBS-like symptoms" },
    ],
  },
  {
    id: "sleep",
    label: "Sleep",
    prompt: "How's your sleep, honestly?",
    options: [
      { value: "fine", label: "Generally fine" },
      { value: "hard-to-fall-asleep", label: "Hard to fall asleep" },
      { value: "wake-at-night", label: "Wake up at night" },
      { value: "not-enough-hours", label: "Not enough hours" },
    ],
  },
  {
    id: "activity",
    label: "Activity level",
    prompt: "How active are you in a typical week?",
    options: [
      { value: "sedentary", label: "Mostly sedentary" },
      { value: "light", label: "Light activity" },
      { value: "regular", label: "Regular exercise" },
      { value: "intense", label: "Intense training" },
    ],
  },
  {
    id: "diet",
    label: "Diet",
    prompt: "Which best describes your diet?",
    options: [
      { value: "omnivore", label: "Everything" },
      { value: "vegetarian", label: "Vegetarian" },
      { value: "vegan", label: "Vegan" },
      { value: "low-carb", label: "Low-carb / keto" },
    ],
  },
  {
    id: "ageRange",
    label: "Age range",
    prompt: "Which age range are you in?",
    options: [
      { value: "under-25", label: "Under 25" },
      { value: "25-34", label: "25–34" },
      { value: "35-44", label: "35–44" },
      { value: "45-54", label: "45–54" },
      { value: "55-plus", label: "55+" },
    ],
  },
  {
    id: "pregnancy",
    label: "Pregnant or breastfeeding",
    prompt: "Are you pregnant or breastfeeding?",
    options: [
      { value: "no", label: "No" },
      { value: "yes", label: "Yes" },
      { value: "prefer-not-to-say", label: "Prefer not to say" },
    ],
  },
];

/** questionId -> selected option value(s). Multi questions hold an array. */
export type Profile = Record<string, string | string[]>;

const STORAGE_KEY = "veda-profile-v1";

export function loadProfile(): Profile | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const clean = sanitizeProfile(parsed as Profile);
    // A profile with nothing answered is the same as no profile — callers
    // use null to decide between the FOR YOU line and the CTA.
    return Object.keys(clean).length > 0 ? clean : null;
  } catch {
    return null;
  }
}

export function saveProfile(profile: Profile): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(sanitizeProfile(profile)));
  } catch {
    // Storage full or blocked (private mode) — personalization just won't stick.
  }
}

export function clearProfile(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

/**
 * Keep only known question ids with values that exist in the schema —
 * run on both sides: before saving to localStorage AND on the server before
 * a profile ever reaches a prompt or a cache key. Free-form input can never
 * pass through this.
 */
export function sanitizeProfile(profile: Profile): Profile {
  const clean: Profile = {};
  for (const q of PROFILE_QUESTIONS) {
    const raw = profile[q.id];
    if (raw == null) continue;
    const allowed = new Set(q.options.map((o) => o.value));
    if (q.multi) {
      const values = (Array.isArray(raw) ? raw : [raw]).filter(
        (v): v is string => typeof v === "string" && allowed.has(v),
      );
      if (values.length > 0) clean[q.id] = [...new Set(values)].sort();
    } else {
      const value = Array.isArray(raw) ? raw[0] : raw;
      if (typeof value === "string" && allowed.has(value)) clean[q.id] = value;
    }
  }
  return clean;
}

/**
 * Human-readable "Skin type: Oily" lines for a sanitized profile — used both
 * to build the LLM prompt server-side and to show "your profile" summaries
 * in the UI.
 */
export function profileToLines(profile: Profile): string[] {
  const lines: string[] = [];
  for (const q of PROFILE_QUESTIONS) {
    const raw = profile[q.id];
    if (raw == null) continue;
    const values = Array.isArray(raw) ? raw : [raw];
    const labels = values
      .map((v) => q.options.find((o) => o.value === v)?.label)
      .filter((l): l is string => !!l);
    if (labels.length > 0) lines.push(`${q.label}: ${labels.join(", ")}`);
  }
  return lines;
}

/**
 * Stable string form used for the server-side cache-key hash: sorted ids,
 * sorted multi values (sanitizeProfile already sorts them). Two users with
 * identical answers always produce the same string.
 */
export function canonicalProfileString(profile: Profile): string {
  const clean = sanitizeProfile(profile);
  return Object.keys(clean)
    .sort()
    .map((id) => {
      const v = clean[id];
      return `${id}=${Array.isArray(v) ? v.join("+") : v}`;
    })
    .join("|");
}

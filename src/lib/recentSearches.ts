// Marks pinned to the wall — one per search.
const KEY = "veda.marks.v2";
const COUNTER_KEY = "veda.counter.v2";
const EVT = "veda:marks";
const MAX = 240;

export type MarkVerdict = "backed" | "mixed" | "debunked";

export interface Mark {
  q: string;
  verdict: MarkVerdict;
  rot: number;     // -4..4
  dx: number;      // small horizontal jitter px
  dy: number;      // small vertical jitter px
  at: number;
  fresh?: boolean; // animate in if just added (set by reader, not persisted)
}

const VERDICTS: MarkVerdict[] = ["backed", "mixed", "debunked"];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function rand(min: number, max: number) {
  return Math.random() * (max - min) + min;
}

export function getMarks(): Mark[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function getCounter(): number {
  if (typeof window === "undefined") return 0;
  try {
    const raw = window.localStorage.getItem(COUNTER_KEY);
    return raw ? Math.max(0, parseInt(raw, 10) || 0) : 0;
  } catch {
    return 0;
  }
}

function setCounter(n: number) {
  try { window.localStorage.setItem(COUNTER_KEY, String(n)); } catch {}
}

export function addMark(q: string, verdict?: MarkVerdict): Mark | null {
  if (typeof window === "undefined") return null;
  const clean = q.trim();
  if (!clean) return null;
  const m: Mark = {
    q: clean,
    verdict: verdict ?? pick(VERDICTS),
    rot: rand(-4, 4),
    dx: rand(-6, 6),
    dy: rand(-4, 4),
    at: Date.now(),
  };
  const next = [m, ...getMarks()].slice(0, MAX);
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
    setCounter(getCounter() + 1);
    window.dispatchEvent(new CustomEvent(EVT, { detail: { freshQ: clean } }));
  } catch {}
  return m;
}

export function subscribeMarks(cb: (freshQ?: string) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = (e: Event) => {
    const d = (e as CustomEvent).detail as { freshQ?: string } | undefined;
    cb(d?.freshQ);
  };
  const storage = (e: StorageEvent) => {
    if (e.key === KEY || e.key === COUNTER_KEY) cb();
  };
  window.addEventListener(EVT, handler);
  window.addEventListener("storage", storage);
  return () => {
    window.removeEventListener(EVT, handler);
    window.removeEventListener("storage", storage);
  };
}

// Back-compat with old SearchBar import path
export function pushRecentSearch(q: string) { addMark(q); }

// 20 seed marks so the wall is never empty.
export const SEED_MARKS: Mark[] = [
  ["rosemary oil", "mixed"],
  ["collagen peptides", "backed"],
  ["ashwagandha", "backed"],
  ["slugging", "backed"],
  ["celery juice detox", "debunked"],
  ["magnesium for sleep", "backed"],
  ["jade roller", "mixed"],
  ["snail mucin", "backed"],
  ["creatine monohydrate", "backed"],
  ["retinol", "backed"],
  ["dry brushing", "mixed"],
  ["intermittent fasting", "mixed"],
  ["gua sha", "mixed"],
  ["vitamin C serum", "backed"],
  ["activated charcoal", "debunked"],
  ["biotin for hair", "mixed"],
  ["hyaluronic acid", "backed"],
  ["turmeric for inflammation", "backed"],
  ["oil pulling", "debunked"],
  ["melatonin", "backed"],
].map(([q, v], i) => ({
  q: q as string,
  verdict: v as MarkVerdict,
  // Deterministic so SSR/CSR match
  rot: ((i * 53) % 80) / 10 - 4,
  dx: ((i * 31) % 120) / 10 - 6,
  dy: ((i * 17) % 80) / 10 - 4,
  at: 0,
}));

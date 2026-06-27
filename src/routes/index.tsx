import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { CATEGORIES, TRENDS, trendBySlug, type Verdict } from "@/lib/trends";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Veda — Is it actually worth it?" },
      {
        name: "description",
        content:
          "A wellness evidence engine. Search any ingredient, product, or ritual — get a verdict that cross-references clinical research and community sentiment.",
      },
      { property: "og:title", content: "Veda — Is it actually worth it?" },
      {
        property: "og:description",
        content: "BACKED, MIXED, or DEBUNKED — for every wellness claim.",
      },
    ],
  }),
  component: Veda,
});

type Mark = {
  name: string;
  slug?: string;
  verdict: Verdict;
  rot: number;
  dx: number;
  dy: number;
  id: number;
};

const TRENDING_SLUGS = ["rosemary-oil", "collagen-peptides", "ashwagandha", "slugging"];

function rand(seed: number) {
  const x = Math.sin(seed * 9301 + 49297) * 233280;
  return x - Math.floor(x);
}

function verdictColor(v: Verdict) {
  return v === "BACKED"
    ? "var(--verdict-backed)"
    : v === "MIXED"
    ? "var(--verdict-mixed)"
    : "var(--verdict-debunked)";
}

function Veda() {
  const initialMarks = useMemo<Mark[]>(
    () =>
      TRENDS.map((t, i) => ({
        name: t.name.toLowerCase(),
        slug: t.slug,
        verdict: t.verdict,
        id: i,
        rot: (rand(i + 1) - 0.5) * 14,
        dx: (rand(i + 11) - 0.5) * 18,
        dy: (rand(i + 31) - 0.5) * 14,
      })),
    [],
  );

  const [marks, setMarks] = useState<Mark[]>(initialMarks);
  const [count, setCount] = useState(35);
  const [query, setQuery] = useState("");
  const navigate = useNavigate();

  useEffect(() => {
    const t = setInterval(() => setCount((c) => c + 1), 12000);
    return () => clearInterval(t);
  }, []);

  function submit(name?: string) {
    const q = (name ?? query).trim();
    if (!q) return;

    // Look up by name or slug
    const match = TRENDS.find(
      (t) =>
        t.name.toLowerCase() === q.toLowerCase() ||
        t.slug === q.toLowerCase().replace(/\s+/g, "-"),
    );

    if (match) {
      navigate({ to: "/trend/$slug", params: { slug: match.slug } });
      return;
    }

    // Otherwise leave a mark
    const verdict: Verdict = (["BACKED", "MIXED", "DEBUNKED"] as Verdict[])[
      Math.floor(Math.random() * 3)
    ];
    const id = Date.now();
    setMarks((prev) => [
      {
        name: q.toLowerCase(),
        verdict,
        id,
        rot: (Math.random() - 0.5) * 14,
        dx: (Math.random() - 0.5) * 18,
        dy: (Math.random() - 0.5) * 14,
      },
      ...prev,
    ]);
    setCount((c) => c + 1);
    setQuery("");
  }

  return (
    <div className="min-h-screen" style={{ backgroundColor: "var(--parchment)" }}>
      <Nav />
      <Hero query={query} setQuery={setQuery} onSubmit={submit} count={count} />
      <WavyDivider from="var(--parchment)" to="var(--ink)" />
      <Stats />
      <WavyDivider from="var(--ink)" to="var(--parchment)" />
      <MarkWall marks={marks} />
      <Footer />
    </div>
  );
}

function Nav() {
  return (
    <nav
      className="sticky top-0 z-40 backdrop-blur-[2px]"
      style={{ backgroundColor: "color-mix(in oklab, var(--parchment) 92%, transparent)" }}
    >
      <div className="mx-auto flex max-w-[1400px] items-center justify-between px-8 py-5">
        <Link to="/" className="flex items-baseline gap-2">
          <span style={{ color: "var(--terracotta)" }} className="text-sm">◆</span>
          <span className="font-display text-[22px]" style={{ color: "var(--ink)" }}>
            veda
          </span>
          <span style={{ color: "var(--muted-ink)", fontFamily: "var(--font-display)" }} className="text-[18px]">
            वेद
          </span>
        </Link>
        <div className="hidden md:flex items-center gap-3 font-label" style={{ fontSize: 10, color: "var(--ink)" }}>
          {CATEGORIES.map((c, i) => (
            <span key={c.slug} className="flex items-center gap-3">
              <Link
                to="/category/$slug"
                params={{ slug: c.slug }}
                className="hover:opacity-60 transition-opacity"
              >
                {c.label}
              </Link>
              {i < CATEGORIES.length - 1 && (
                <span style={{ color: "var(--muted-ink)", opacity: 0.5 }}>·</span>
              )}
            </span>
          ))}
        </div>
      </div>
    </nav>
  );
}

function Hero({
  query,
  setQuery,
  onSubmit,
  count,
}: {
  query: string;
  setQuery: (s: string) => void;
  onSubmit: (n?: string) => void;
  count: number;
}) {
  const archPath =
    "M 60 360 L 60 200 C 60 120, 130 60, 220 30 L 220 18 L 240 30 L 240 18 L 260 30 C 350 60, 420 120, 420 200 L 420 360";

  return (
    <section className="relative" style={{ minHeight: "100vh" }}>
      <div className="relative z-10 flex min-h-screen flex-col items-center justify-center px-4 pt-8 pb-12">
        <p
          className="font-label text-center"
          style={{
            color: "var(--terracotta)",
            fontSize: 11,
            animation: "fade-up 1.2s ease-out 0.1s both",
          }}
        >
          THE WELLNESS EVIDENCE ENGINE
        </p>

        <h1
          className="font-display text-center leading-[0.95] mt-3"
          style={{
            fontSize: "clamp(44px, 8vw, 112px)",
            color: "var(--ink)",
            letterSpacing: "-0.02em",
            animation: "fade-up 1.2s ease-out 0.2s both",
          }}
        >
          Is it actually <span style={{ color: "var(--terracotta)" }}>worth it?</span>
        </h1>

        <p
          className="mt-6 max-w-xl text-center leading-snug"
          style={{
            color: "var(--ink)",
            fontSize: 16,
            fontWeight: 300,
            animation: "fade-up 1.2s ease-out 0.6s both",
            whiteSpace: "pre-line",
          }}
        >
          Search any ingredient, product, or ritual.{"\u00a0"}{"\n"}
          We read the research papers and the Reddit threads so you don't have to.{"\n"}
        </p>




        <div
          className="relative mt-6"
          style={{
            width: "min(480px, 92vw)",
            animation: "fade-up 1.2s ease-out 1.0s both",
          }}
        >
          <ArchSVG archPath={archPath} />

          <div
            className="absolute left-1/2 -translate-x-1/2"
            style={{ bottom: "12%", width: "82%" }}
          >
            <form
              onSubmit={(e) => {
                e.preventDefault();
                onSubmit();
              }}
              className="group flex items-center gap-2 rounded-full px-4 py-3 transition-shadow"
              style={{ backgroundColor: "var(--parchment-deep)" }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ color: "var(--muted-ink)" }}>
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-3.5-3.5" strokeLinecap="round" />
              </svg>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="try 'creatine for muscle growth'..."
                className="flex-1 bg-transparent outline-none placeholder:opacity-70"
                style={{ color: "var(--ink)", fontSize: 15, fontWeight: 300 }}
              />
              <button
                type="submit"
                className="rounded-full px-3 py-1.5 font-label transition-opacity hover:opacity-90"
                style={{
                  backgroundColor: "var(--ink)",
                  color: "var(--parchment)",
                  fontSize: 11,
                  letterSpacing: "0.14em",
                }}
              >
                LOOK IT UP →
              </button>
            </form>
          </div>
        </div>

        <div
          className="mt-5 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 px-4 text-center"
          style={{ animation: "fade-up 1.2s ease-out 1.4s both" }}
        >
          <span className="font-label" style={{ color: "var(--terracotta)", fontSize: 10 }}>
            TRYING NOW
          </span>
          {TRENDING_SLUGS.map((slug, i) => {
            const t = trendBySlug(slug);
            if (!t) return null;
            return (
              <span key={slug} className="flex items-center gap-3">
                <Link
                  to="/trend/$slug"
                  params={{ slug }}
                  className="hover:opacity-60 transition-opacity"
                  style={{ color: "var(--ink)", fontSize: 15, fontWeight: 300 }}
                >
                  {t.name.toLowerCase()}
                </Link>
                {i < TRENDING_SLUGS.length - 1 && (
                  <span style={{ color: "var(--muted-ink)", opacity: 0.5 }}>·</span>
                )}
              </span>
            );
          })}
        </div>

        <div
          className="mt-5 text-center font-display"
          style={{
            color: "var(--ink)",
            fontSize: 28,
            animation: "fade-up 1.2s ease-out 1.6s both",
          }}
        >
          <CountUp value={count} duration={2400} /> trends verified
        </div>
      </div>
    </section>
  );
}

function ArchSVG({ archPath }: { archPath: string }) {
  const pathRef = useRef<SVGPathElement | null>(null);
  const [len, setLen] = useState(1800);

  useEffect(() => {
    if (pathRef.current) setLen(pathRef.current.getTotalLength());
  }, []);

  return (
    <svg viewBox="0 0 480 380" className="w-full h-auto" style={{ overflow: "visible" }}>
      <path
        d={archPath}
        fill="none"
        stroke="var(--ink)"
        strokeOpacity="0.18"
        strokeWidth="2.5"
        strokeLinecap="round"
        style={{
          strokeDasharray: len,
          strokeDashoffset: len,
          animation: `draw 2.8s ease-out 0.4s forwards`,
        }}
      />
      <path
        ref={pathRef}
        d={archPath}
        fill="none"
        stroke="var(--ink)"
        strokeOpacity="0.85"
        strokeWidth="1"
        strokeLinecap="round"
        style={{
          strokeDasharray: len,
          strokeDashoffset: len,
          animation: `draw 2.8s ease-out 0.4s forwards`,
        }}
      />
      <path
        d="M 60 360 C 180 380, 300 380, 420 360"
        fill="none"
        stroke="var(--ink)"
        strokeOpacity="0.5"
        strokeWidth="1"
        strokeLinecap="round"
        style={{
          strokeDasharray: 500,
          strokeDashoffset: 500,
          animation: `draw 1.6s ease-out 2.6s forwards`,
        }}
      />
      {[
        [105, 250],
        [85, 180],
        [140, 105],
        [340, 105],
        [395, 180],
        [375, 250],
      ].map(([cx, cy], i) => (
        <circle
          key={i}
          cx={cx}
          cy={cy}
          r="2"
          fill="var(--terracotta)"
          style={{ opacity: 0, animation: `bloom 0.8s ease-out ${2.8 + i * 0.1}s forwards` }}
        />
      ))}
    </svg>
  );
}





function CountUp({ value, duration = 2400 }: { value: number; duration?: number }) {
  const [display, setDisplay] = useState(value);
  const prev = useRef(value);
  useEffect(() => {
    const start = prev.current;
    const end = value;
    const t0 = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      const v = Math.round(start + (end - start) * eased);
      setDisplay(v);
      if (p < 1) raf = requestAnimationFrame(tick);
      else prev.current = end;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);
  return <span>{display.toLocaleString()}</span>;
}

function WavyDivider({ from, to }: { from: string; to: string }) {
  return (
    <div style={{ backgroundColor: from, lineHeight: 0 }}>
      <svg viewBox="0 0 1440 60" preserveAspectRatio="none" className="w-full" style={{ height: 60, display: "block" }}>
        <path
          d="M0,30 C180,55 360,5 540,30 C720,55 900,5 1080,30 C1260,55 1440,5 1440,30 L1440,60 L0,60 Z"
          fill={to}
        />
        <path
          d="M0,30 C180,55 360,5 540,30 C720,55 900,5 1080,30 C1260,55 1440,5 1440,30"
          fill="none"
          stroke="var(--ink)"
          strokeOpacity="0.18"
          strokeWidth="1"
        />
      </svg>
    </div>
  );
}

function Stats() {
  const stats = [
    { num: "$9,000,000", size: 56, label: "lost every day to misinformation-driven wellness purchases" },
    { num: "55%", size: 88, label: "of people who bought based on social content felt cheated afterward" },
    { num: "1 in 2", size: 88, label: "Americans have bought a health product directly from a social media ad" },
  ];

  return (
    <section style={{ backgroundColor: "var(--ink)" }} className="py-20">
      <div className="mx-auto grid max-w-[1200px] grid-cols-1 gap-12 px-8 md:grid-cols-3 md:gap-0">
        {stats.map((s, i) => (
          <div
            key={i}
            className="px-8 text-center"
            style={{
              borderLeft: i > 0 ? "0.5px solid color-mix(in oklab, var(--parchment) 25%, transparent)" : undefined,
            }}
          >
            <div
              className="font-display leading-none"
              style={{ color: "var(--parchment)", fontSize: s.size }}
            >
              <StatCountUp text={s.num} />
            </div>
            <p
              className="mx-auto mt-5 max-w-[260px]"
              style={{ color: "var(--parchment)", fontSize: 13, fontWeight: 300, lineHeight: 1.5, opacity: 0.85 }}
            >
              {s.label}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

function StatCountUp({ text }: { text: string }) {
  const ref = useRef<HTMLSpanElement | null>(null);
  const [display, setDisplay] = useState(text);
  const [started, setStarted] = useState(false);

  useEffect(() => {
    if (!ref.current) return;
    const obs = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting && !started) {
            setStarted(true);
            animate();
          }
        });
      },
      { threshold: 0.4 },
    );
    obs.observe(ref.current);
    return () => obs.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [started]);

  function animate() {
    const match = text.match(/[\d,]+/);
    if (!match) return;
    const target = parseInt(match[0].replace(/,/g, ""), 10);
    const prefix = text.slice(0, match.index);
    const suffix = text.slice((match.index ?? 0) + match[0].length);
    const t0 = performance.now();
    const duration = 3200;
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / duration);
      // smooth ease-out, no overshoot
      const eased = 1 - Math.pow(1 - p, 4);
      const v = Math.round(target * eased);
      const isInOne = /1 in/.test(text);
      const formatted = isInOne ? v.toString() : v.toLocaleString();
      setDisplay(prefix + formatted + suffix);
      if (p < 1) requestAnimationFrame(tick);
      else setDisplay(text);
    };
    requestAnimationFrame(tick);
  }

  return <span ref={ref}>{started ? display : text.replace(/[\d]/g, "0")}</span>;
}

function MarkWall({ marks }: { marks: Mark[] }) {
  return (
    <section
      style={{ backgroundColor: "var(--parchment)" }}
      className="px-6 py-20"
      aria-label="Search history wall"
    >
      <div className="mx-auto max-w-[980px]">
        <div className="text-center">
          <p className="font-label text-[10px]" style={{ color: "var(--terracotta)" }}>
            THE MARK WALL
          </p>
          <h2 className="font-display mt-2" style={{ color: "var(--ink)", fontSize: 36 }}>
            Every search leaves a stamp.
          </h2>
          <p className="mt-2" style={{ color: "var(--muted-ink)", fontSize: 13 }}>
            Tap a seal to see the evidence.
          </p>
        </div>
        <div className="mt-10 flex flex-wrap justify-center gap-x-5 gap-y-6">
          {marks.map((m, i) => (
            <MarkSeal key={m.id} m={m} index={i} />
          ))}
        </div>
      </div>
    </section>
  );
}

function MarkSeal({ m, index }: { m: Mark; index: number }) {
  const color = verdictColor(m.verdict);

  const icon = (
    <div
      className="group relative flex items-center justify-center transition-transform hover:-translate-y-0.5 hover:scale-110"
      title={`${m.name} — ${m.verdict}`}
      style={
        {
          width: 44,
          height: 44,
          color,
          transform: `rotate(${m.rot}deg) translate(${m.dx * 0.3}px, ${m.dy * 0.3}px)`,
          ["--rot-start" as string]: `${m.rot - 6}deg`,
          ["--rot-end" as string]: `${m.rot}deg`,
          animation: index < TRENDS.length ? undefined : "drop-in 0.9s cubic-bezier(.4,1.4,.6,1) both",
        } as React.CSSProperties
      }
    >
      <TrendIcon name={m.name} slug={m.slug} size={36} />
    </div>
  );

  if (m.slug) {
    return (
      <Link to="/trend/$slug" params={{ slug: m.slug }} className="no-underline">
        {icon}
      </Link>
    );
  }
  return icon;
}


/**
 * Hand-drawn icon for a trend. Picks by slug when known, falls back to
 * keyword-matching the free-text query so user-added marks still get a real icon.
 */
function TrendIcon({ name, slug, size = 24 }: { name: string; slug?: string; size?: number }) {
  const key = pickIconKey(slug, name);
  const Icon = ICONS[key];
  return <Icon size={size} />;
}

type IconKey =
  | "sun" | "vial" | "capsule" | "droplet" | "leaf" | "brush"
  | "roller" | "stone" | "mask" | "clock" | "glass" | "muscle"
  | "tube" | "mortar" | "moon" | "flame" | "spark"
  | "dropper" | "beaker" | "jar" | "bottle" | "pillow" | "root" | "mouth" | "snail";

const SLUG_ICON: Record<string, IconKey> = {
  "daily-spf": "sun",
  "retinol": "vial",
  "vitamin-c-serum": "dropper",
  "niacinamide": "beaker",
  "hyaluronic-acid": "droplet",
  "snail-mucin": "snail",
  "slugging": "tube",
  "jade-roller": "roller",
  "gua-sha": "stone",
  "activated-charcoal": "mask",
  "dry-brushing": "brush",
  "rosemary-oil": "leaf",
  "biotin": "capsule",
  "collagen-peptides": "bottle",
  "ashwagandha": "mortar",
  "creatine": "muscle",
  "melatonin": "moon",
  "magnesium-sleep": "pillow",
  "celery-juice": "glass",
  "turmeric": "root",
  "intermittent-fasting": "clock",
  "oil-pulling": "mouth",
  "castor-oil": "jar",
  "beef-liver": "flame",
};

function pickIconKey(slug: string | undefined, name: string): IconKey {
  if (slug && SLUG_ICON[slug]) return SLUG_ICON[slug];
  const n = name.toLowerCase();
  if (/spf|sunscreen|sun\b/.test(n)) return "sun";
  if (/serum|retinol|vitamin c|niacinamide|peptide.*serum/.test(n)) return "vial";
  if (/oil|drop/.test(n)) return "droplet";
  if (/cream|balm|slug|moisturi[sz]er/.test(n)) return "tube";
  if (/roller/.test(n)) return "roller";
  if (/gua sha|stone/.test(n)) return "stone";
  if (/mask|charcoal/.test(n)) return "mask";
  if (/brush|exfolia/.test(n)) return "brush";
  if (/leaf|rosemary|herb|tea/.test(n)) return "leaf";
  if (/capsule|pill|tablet|biotin|collagen|liver/.test(n)) return "capsule";
  if (/muscle|creatine|protein|gym|strength/.test(n)) return "muscle";
  if (/sleep|melatonin|magnesium|night|insomn/.test(n)) return "moon";
  if (/fast|clock|hour|timing/.test(n)) return "clock";
  if (/juice|drink|water|smoothie|tonic/.test(n)) return "glass";
  if (/turmeric|ashwagandha|adaptogen|powder|root/.test(n)) return "mortar";
  if (/inflam|fire|hot/.test(n)) return "flame";
  return "spark";
}

const SW = 1.4;
const ICONS: Record<IconKey, React.FC<{ size?: number }>> = {
  sun: ({ size = 24 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={SW} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="4" />
      {Array.from({ length: 8 }).map((_, i) => {
        const a = (i / 8) * Math.PI * 2;
        return <line key={i} x1={12 + Math.cos(a) * 7} y1={12 + Math.sin(a) * 7} x2={12 + Math.cos(a) * 9.5} y2={12 + Math.sin(a) * 9.5} />;
      })}
    </svg>
  ),
  vial: ({ size = 24 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={SW} strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 3h4" />
      <path d="M11 3v4l-2.5 4.5a4 4 0 0 0 3.5 6 4 4 0 0 0 3.5-6L13 7V3" />
      <path d="M9.5 14h5" />
    </svg>
  ),
  capsule: ({ size = 24 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={SW} strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="9" width="18" height="6" rx="3" transform="rotate(-25 12 12)" />
      <path d="M9.5 7.5l4.5 9" />
    </svg>
  ),
  droplet: ({ size = 24 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={SW} strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3c-3.5 5-6 8-6 11a6 6 0 0 0 12 0c0-3-2.5-6-6-11z" />
    </svg>
  ),
  leaf: ({ size = 24 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={SW} strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 4c-9 0-15 4-15 11 0 3 2 5 5 5 7 0 11-6 11-15z" />
      <path d="M5 20c2-5 6-9 12-12" />
    </svg>
  ),
  brush: ({ size = 24 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={SW} strokeLinecap="round" strokeLinejoin="round">
      <rect x="6" y="3" width="12" height="7" rx="1.5" />
      <path d="M8 10v3M10.5 10v4M13.5 10v4M16 10v3" />
      <path d="M11 18h2v3h-2z" />
    </svg>
  ),
  roller: ({ size = 24 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={SW} strokeLinecap="round" strokeLinejoin="round">
      <ellipse cx="7" cy="8" rx="3.5" ry="2.5" />
      <ellipse cx="17" cy="16" rx="3.5" ry="2.5" />
      <path d="M9.5 9.5l5 5" />
    </svg>
  ),
  stone: ({ size = 24 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={SW} strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 14c0-4 4-9 9-9 4 0 7 2 7 5s-3 4-3 7-3 5-7 5-6-3-6-8z" />
    </svg>
  ),
  mask: ({ size = 24 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={SW} strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 6c2-2 14-2 16 0 1 4 0 12-3 14-2 1-8 1-10 0-3-2-4-10-3-14z" />
      <circle cx="9" cy="11" r="1" /><circle cx="15" cy="11" r="1" />
    </svg>
  ),
  clock: ({ size = 24 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={SW} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  ),
  glass: ({ size = 24 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={SW} strokeLinecap="round" strokeLinejoin="round">
      <path d="M7 4h10l-1.5 16h-7z" />
      <path d="M7.5 9h9" />
    </svg>
  ),
  muscle: ({ size = 24 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={SW} strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 10c2-3 6-3 8-1l5 4c2 1.5 2 5-1 6-2 .5-4-.5-5-2" />
      <path d="M6 10c-.5 3 .5 6 4 7" />
      <circle cx="18" cy="8" r="2" />
    </svg>
  ),
  tube: ({ size = 24 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={SW} strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 5h12l-1 14a2 2 0 0 1-2 2h-6a2 2 0 0 1-2-2z" />
      <path d="M6 5l1-2h10l1 2" />
      <path d="M9 11h6" />
    </svg>
  ),
  mortar: ({ size = 24 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={SW} strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 12h16l-2 6a2 2 0 0 1-2 1.5H8a2 2 0 0 1-2-1.5z" />
      <path d="M3 12h18" />
      <path d="M15 11l4-7" />
    </svg>
  ),
  moon: ({ size = 24 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={SW} strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 14a8 8 0 1 1-10-10 6 6 0 0 0 10 10z" />
    </svg>
  ),
  flame: ({ size = 24 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={SW} strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3c1 3 5 5 5 10a5 5 0 0 1-10 0c0-2 1-3 2-4 0 2 1 3 2 3 0-3-1-5 1-9z" />
    </svg>
  ),
  spark: ({ size = 24 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={SW} strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3v6M12 15v6M3 12h6M15 12h6M6 6l4 4M14 14l4 4M18 6l-4 4M10 14l-4 4" />
    </svg>
  ),
  dropper: ({ size = 24 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={SW} strokeLinecap="round" strokeLinejoin="round">
      <rect x="10" y="2" width="4" height="10" rx="1" />
      <path d="M9 12h6" />
      <path d="M12 12v6c0 2-2 3-2 3" />
      <circle cx="10" cy="21" r="0.6" fill="currentColor" />
    </svg>
  ),
  beaker: ({ size = 24 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={SW} strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 3h8M9 3v6l-4 9a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-4-9V3" />
      <path d="M6 15h12" />
    </svg>
  ),
  jar: ({ size = 24 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={SW} strokeLinecap="round" strokeLinejoin="round">
      <rect x="6" y="3" width="12" height="3" rx="1" />
      <path d="M7 6h10v13a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2z" />
      <path d="M9 12h6" />
    </svg>
  ),
  bottle: ({ size = 24 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={SW} strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 2h4v3h-4z" />
      <path d="M9 5h6l1 4v10a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2V9z" />
      <path d="M9 11h6" />
    </svg>
  ),
  pillow: ({ size = 24 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={SW} strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9c0-2 2-3 4-3h10c2 0 4 1 4 3v6c0 2-2 3-4 3H7c-2 0-4-1-4-3z" />
      <path d="M6 9c2 1 2 5 0 6M18 9c-2 1-2 5 0 6" />
    </svg>
  ),
  root: ({ size = 24 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={SW} strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3c-2 3-5 4-5 8s3 6 5 6 5-2 5-6-3-5-5-8z" />
      <path d="M12 17v4M9 19l-2 2M15 19l2 2" />
    </svg>
  ),
  mouth: ({ size = 24 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={SW} strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 12c3-4 15-4 18 0-3 4-15 4-18 0z" />
      <path d="M8 12c1-1 7-1 8 0" />
    </svg>
  ),
  snail: ({ size = 24 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={SW} strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 18h14a6 6 0 1 0-6-6c0 2 1 3 3 3s3-1 3-3" />
      <path d="M16 8V4M14 4l2-1 2 1" />
    </svg>
  ),
};



function Footer() {
  return (
    <footer
      className="border-t px-8 py-10"
      style={{
        backgroundColor: "var(--parchment)",
        borderColor: "color-mix(in oklab, var(--ink) 12%, transparent)",
      }}
    >
      <div className="mx-auto flex max-w-[1400px] flex-col items-center justify-between gap-4 text-center md:flex-row md:text-left">
        <div className="flex items-baseline gap-2">
          <span style={{ color: "var(--terracotta)" }}>◆</span>
          <span className="font-display text-xl" style={{ color: "var(--ink)" }}>veda</span>
          <span style={{ color: "var(--muted-ink)", fontFamily: "var(--font-display)" }} className="text-base">वेद</span>
        </div>
        <p className="font-label" style={{ color: "var(--muted-ink)", fontSize: 10 }}>
          EVIDENCE OVER ALGORITHM · EST 2026
        </p>
      </div>
    </footer>
  );
}

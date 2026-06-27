import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Veda — Is it actually worth it?" },
      {
        name: "description",
        content:
          "A wellness evidence engine. Search any ingredient, product, or ritual and get a verdict backed by PubMed research.",
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

type Verdict = "BACKED" | "MIXED" | "DEBUNKED";
type Mark = { name: string; verdict: Verdict; rot: number; dx: number; dy: number; id: number };

const SEED: { name: string; verdict: Verdict }[] = [
  { name: "rosemary oil", verdict: "MIXED" },
  { name: "collagen peptides", verdict: "BACKED" },
  { name: "ashwagandha", verdict: "BACKED" },
  { name: "slugging", verdict: "BACKED" },
  { name: "celery juice detox", verdict: "DEBUNKED" },
  { name: "magnesium for sleep", verdict: "BACKED" },
  { name: "jade roller", verdict: "MIXED" },
  { name: "snail mucin", verdict: "BACKED" },
  { name: "creatine monohydrate", verdict: "BACKED" },
  { name: "retinol", verdict: "BACKED" },
  { name: "dry brushing", verdict: "MIXED" },
  { name: "intermittent fasting", verdict: "MIXED" },
  { name: "gua sha", verdict: "MIXED" },
  { name: "vitamin C serum", verdict: "BACKED" },
  { name: "activated charcoal", verdict: "DEBUNKED" },
  { name: "biotin for hair", verdict: "MIXED" },
  { name: "hyaluronic acid", verdict: "BACKED" },
  { name: "turmeric for inflammation", verdict: "BACKED" },
  { name: "oil pulling", verdict: "DEBUNKED" },
  { name: "melatonin", verdict: "BACKED" },
];

const CATEGORIES = [
  "SKINCARE",
  "HAIRCARE",
  "SUPPLEMENTS",
  "NUTRITION",
  "SLEEP",
  "GUT HEALTH",
  "FITNESS",
  "MENTAL WELLNESS",
];

const TRENDING = ["rosemary oil", "collagen peptides", "ashwagandha", "slugging"];

function rand(seed: number) {
  // deterministic pseudo-random per index for SSR-safe layout
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
      SEED.map((s, i) => ({
        ...s,
        id: i,
        rot: (rand(i + 1) - 0.5) * 8,
        dx: (rand(i + 11) - 0.5) * 14,
        dy: (rand(i + 31) - 0.5) * 10,
      })),
    [],
  );

  const [marks, setMarks] = useState<Mark[]>(initialMarks);
  const [count, setCount] = useState(48213);
  const [query, setQuery] = useState("");
  const [archTrace, setArchTrace] = useState(0);
  const archPathRef = useRef<SVGPathElement | null>(null);

  // gentle counter drift to feel "live"
  useEffect(() => {
    const t = setInterval(() => setCount((c) => c + 1), 7000);
    return () => clearInterval(t);
  }, []);

  function submit(name?: string) {
    const q = (name ?? query).trim();
    if (!q) return;
    const verdict: Verdict = (["BACKED", "MIXED", "DEBUNKED"] as Verdict[])[
      Math.floor(Math.random() * 3)
    ];
    const id = Date.now();
    setMarks((prev) => [
      {
        name: q,
        verdict,
        id,
        rot: (Math.random() - 0.5) * 8,
        dx: (Math.random() - 0.5) * 14,
        dy: (Math.random() - 0.5) * 10,
      },
      ...prev,
    ]);
    setCount((c) => c + 1);
    setQuery("");
    setArchTrace((n) => n + 1);
  }

  return (
    <div className="min-h-screen" style={{ backgroundColor: "var(--parchment)" }}>
      <Nav />
      <Hero
        query={query}
        setQuery={setQuery}
        onSubmit={submit}
        count={count}
        archTrace={archTrace}
        archPathRef={archPathRef}
      />
      <WavyDivider from="var(--parchment)" to="var(--blush)" />
      <Stats />
      <WavyDivider from="var(--blush)" to="var(--parchment)" />
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
        <a href="#" className="flex items-baseline gap-2">
          <span style={{ color: "var(--terracotta)" }} className="text-sm">◆</span>
          <span className="font-display text-[22px]" style={{ color: "var(--ink)" }}>
            veda
          </span>
          <span style={{ color: "var(--muted-ink)", fontFamily: "var(--font-display)" }} className="text-[18px]">
            वेद
          </span>
        </a>
        <div className="hidden md:flex items-center gap-3 font-label" style={{ fontSize: 10, color: "var(--ink)" }}>
          {CATEGORIES.map((c, i) => (
            <span key={c} className="flex items-center gap-3">
              <a href={`#${c.toLowerCase().replace(" ", "-")}`} className="hover:opacity-70 transition-opacity">
                {c}
              </a>
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
  archTrace,
  archPathRef,
}: {
  query: string;
  setQuery: (s: string) => void;
  onSubmit: (n?: string) => void;
  count: number;
  archTrace: number;
  archPathRef: React.MutableRefObject<SVGPathElement | null>;
}) {
  // arch path (pointed Mughal-style)
  const archPath =
    "M 60 360 L 60 200 C 60 120, 130 60, 220 30 L 220 18 L 240 30 L 240 18 L 260 30 C 350 60, 420 120, 420 200 L 420 360";

  return (
    <section className="relative" style={{ minHeight: "100vh" }}>
      {/* Corner botanicals */}
      <CornerVine side="left" />
      <CornerVine side="right" />

      <div className="relative z-10 flex min-h-screen flex-col items-center justify-center px-6 pt-8 pb-12">
        {/* Headline */}
        <h1
          className="font-display text-center leading-[0.95]"
          style={{
            fontSize: "clamp(56px, 9vw, 96px)",
            color: "var(--ink)",
            animation: "fade-up 0.7s ease-out 1.6s both",
          }}
        >
          Is it actually
          <br />
          <span style={{ color: "var(--terracotta)" }}>worth it?</span>
        </h1>

        {/* Subtitle - tight to headline */}
        <p
          className="mt-3 max-w-xl text-center leading-snug"
          style={{
            color: "var(--muted-ink)",
            fontSize: 15,
            fontWeight: 300,
            animation: "fade-up 0.6s ease-out 1.9s both",
          }}
        >
          Search any ingredient, product, or wellness ritual.
          <br />
          We cross-reference the clinical evidence and tell you if it actually works.
        </p>

        {/* Arch + search */}
        <div
          className="relative mt-5"
          style={{
            width: "min(480px, 92vw)",
            animation: "fade-up 0.6s ease-out 2.1s both",
          }}
        >
          <ArchSVG archPath={archPath} traceTrigger={archTrace} pathRef={archPathRef} />

          {/* Search bar positioned inside arch base */}
          <div
            className="absolute left-1/2 -translate-x-1/2"
            style={{ bottom: "12%", width: "78%" }}
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
                placeholder="try 'rosemary oil for hair' or 'magnesium for sleep'..."
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

        {/* Trending */}
        <div
          className="mt-4 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 px-4 text-center"
          style={{ animation: "fade-up 0.6s ease-out 2.25s both" }}
        >
          <span className="font-label" style={{ color: "var(--terracotta)", fontSize: 10 }}>
            TRYING NOW
          </span>
          {TRENDING.map((t, i) => (
            <span key={t} className="flex items-center gap-3">
              <button
                onClick={() => onSubmit(t)}
                className="hover:opacity-60 transition-opacity"
                style={{ color: "var(--ink)", fontSize: 15, fontWeight: 300 }}
              >
                {t}
              </button>
              {i < TRENDING.length - 1 && (
                <span style={{ color: "var(--muted-ink)", opacity: 0.5 }}>·</span>
              )}
            </span>
          ))}
        </div>

        {/* Counter */}
        <div
          className="mt-4 text-center font-display"
          style={{
            color: "var(--ink)",
            fontSize: 32,
            animation: "fade-up 0.6s ease-out 2.4s both",
          }}
        >
          <CountUp value={count} duration={1200} /> trends verified
        </div>
      </div>
    </section>
  );
}

function ArchSVG({
  archPath,
  traceTrigger,
  pathRef,
}: {
  archPath: string;
  traceTrigger: number;
  pathRef: React.MutableRefObject<SVGPathElement | null>;
}) {
  const [len, setLen] = useState(1800);
  const tracerRef = useRef<SVGPathElement | null>(null);

  useEffect(() => {
    if (pathRef.current) setLen(pathRef.current.getTotalLength());
  }, [pathRef]);

  useEffect(() => {
    if (!traceTrigger || !tracerRef.current) return;
    const el = tracerRef.current;
    el.style.animation = "none";
    // reflow
    void el.getBoundingClientRect();
    el.style.animation = "arch-trace 0.9s ease-out forwards";
  }, [traceTrigger]);

  return (
    <svg viewBox="0 0 480 380" className="w-full h-auto" style={{ overflow: "visible" }}>
      {/* outer faint */}
      <path
        d={archPath}
        fill="none"
        stroke="var(--ink)"
        strokeOpacity="0.22"
        strokeWidth="2.5"
        strokeLinecap="round"
        style={{
          strokeDasharray: len,
          strokeDashoffset: len,
          animation: `draw 1.5s ease-out 0.9s forwards`,
        }}
      />
      {/* inner crisp */}
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
          animation: `draw 1.5s ease-out 0.9s forwards`,
        }}
      />
      {/* base line closing arch */}
      <path
        d="M 60 360 C 180 380, 300 380, 420 360"
        fill="none"
        stroke="var(--ink)"
        strokeOpacity="0.6"
        strokeWidth="1"
        strokeLinecap="round"
        style={{
          strokeDasharray: 500,
          strokeDashoffset: 500,
          animation: `draw 0.9s ease-out 2.0s forwards`,
        }}
      />
      {/* decorative dots */}
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
          style={{ opacity: 0, animation: `bloom 0.4s ease-out ${2.0 + i * 0.05}s forwards` }}
        />
      ))}
      {/* finial lotus at peak */}
      <g
        transform="translate(240 8)"
        style={{
          transformOrigin: "240px 8px",
          opacity: 0,
          animation: "bloom 0.6s ease-out 2.3s forwards",
        }}
      >
        <Lotus size={20} />
      </g>

      {/* tracer overlay for search submission */}
      <path
        ref={tracerRef}
        d={archPath}
        fill="none"
        stroke="var(--terracotta)"
        strokeWidth="2"
        strokeLinecap="round"
        style={
          {
            strokeDasharray: 120,
            strokeDashoffset: len,
            ["--len" as string]: `${len}`,
            opacity: 0,
          } as React.CSSProperties
        }
      />
    </svg>
  );
}

function Lotus({ size = 20 }: { size?: number }) {
  const petals = 8;
  return (
    <g>
      {Array.from({ length: petals }).map((_, i) => {
        const angle = (360 / petals) * i;
        return (
          <ellipse
            key={i}
            cx="0"
            cy={-size * 0.45}
            rx={size * 0.18}
            ry={size * 0.45}
            fill="var(--terracotta)"
            opacity="0.85"
            transform={`rotate(${angle})`}
          />
        );
      })}
      <circle cx="0" cy="0" r={size * 0.22} fill="var(--parchment)" stroke="var(--terracotta)" strokeWidth="0.8" />
    </g>
  );
}

function CornerVine({ side }: { side: "left" | "right" }) {
  const flip = side === "right";
  const pathD = "M 20 0 C 30 60, 70 90, 90 160 C 100 210, 70 250, 110 320";
  const branchA = "M 60 100 C 90 110, 110 95, 130 80";
  const branchB = "M 85 200 C 60 210, 40 200, 25 175";
  const branchC = "M 100 270 C 130 280, 150 270, 165 245";

  return (
    <div
      className="pointer-events-none absolute top-0 z-0"
      style={{
        [side]: 0,
        width: "min(280px, 28vw)",
        height: "min(380px, 50vh)",
        transform: flip ? "scaleX(-1)" : undefined,
      }}
    >
      <svg viewBox="0 0 200 360" className="w-full h-full" style={{ overflow: "visible" }}>
        <g style={{ transformOrigin: "0 0", animation: "sway 9s ease-in-out 3s infinite" }}>
          {[pathD, branchA, branchB, branchC].map((d, i) => (
            <path
              key={i}
              d={d}
              fill="none"
              stroke="var(--stem)"
              strokeWidth={i === 0 ? 1.4 : 1}
              strokeLinecap="round"
              style={{
                strokeDasharray: 600,
                strokeDashoffset: 600,
                animation: `draw 1.4s ease-out ${0.1 + i * 0.25}s forwards`,
              }}
            />
          ))}
          {/* leaves */}
          {[
            [70, 130, 18],
            [50, 220, -25],
            [120, 170, 35],
            [140, 260, -15],
            [40, 80, -40],
          ].map(([x, y, r], i) => (
            <g
              key={i}
              transform={`translate(${x} ${y}) rotate(${r})`}
              style={{ opacity: 0, animation: `bloom 0.5s ease-out ${1.0 + i * 0.15}s forwards`, transformOrigin: `${x}px ${y}px` }}
            >
              <ellipse cx="0" cy="0" rx="14" ry="6" fill="var(--sage)" opacity="0.85" />
              <line x1="-14" y1="0" x2="14" y2="0" stroke="var(--stem)" strokeWidth="0.5" opacity="0.6" />
            </g>
          ))}
          {/* lotus blooms at branch ends */}
          {[
            [130, 80, 12],
            [25, 175, 14],
            [165, 245, 13],
            [110, 320, 16],
          ].map(([x, y, s], i) => (
            <g
              key={i}
              transform={`translate(${x} ${y})`}
              style={{
                opacity: 0,
                animation: `bloom 0.6s ease-out ${1.6 + i * 0.18}s forwards`,
                transformOrigin: `${x}px ${y}px`,
              }}
            >
              <Lotus size={s} />
            </g>
          ))}
        </g>
      </svg>
    </div>
  );
}

function CountUp({ value, duration = 1000 }: { value: number; duration?: number }) {
  const [display, setDisplay] = useState(value);
  const prev = useRef(value);
  useEffect(() => {
    const start = prev.current;
    const end = value;
    const t0 = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / duration);
      // ease-out with slight overshoot
      const eased = 1 - Math.pow(1 - p, 3);
      const overshoot = p < 1 ? Math.sin(p * Math.PI) * 0.02 : 0;
      const v = Math.round(start + (end - start) * (eased + overshoot));
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
    <section style={{ backgroundColor: "var(--blush)" }} className="py-20">
      <div className="mx-auto grid max-w-[1200px] grid-cols-1 gap-12 px-8 md:grid-cols-3 md:gap-0">
        {stats.map((s, i) => (
          <div
            key={i}
            className="px-8 text-center"
            style={{
              borderLeft: i > 0 ? "0.5px solid color-mix(in oklab, var(--ink) 20%, transparent)" : undefined,
            }}
          >
            <div
              className="font-display leading-none"
              style={{ color: "var(--ink)", fontSize: s.size }}
            >
              <StatCountUp text={s.num} />
            </div>
            <p
              className="mx-auto mt-5 max-w-[260px]"
              style={{ color: "var(--ink)", fontSize: 13, fontWeight: 300, lineHeight: 1.5 }}
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
    // extract numeric portion
    const match = text.match(/[\d,]+/);
    if (!match) return;
    const target = parseInt(match[0].replace(/,/g, ""), 10);
    const prefix = text.slice(0, match.index);
    const suffix = text.slice((match.index ?? 0) + match[0].length);
    const t0 = performance.now();
    const duration = 1600;
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      const overshoot = p < 1 ? Math.sin(p * Math.PI) * 0.04 : 0;
      const v = Math.round(target * (eased + overshoot));
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
      className="px-6 py-24"
      aria-label="Search history wall"
    >
      <div className="mx-auto max-w-[1200px]">
        <div className="flex flex-wrap justify-center gap-2">
          {marks.map((m, i) => (
            <MarkTag key={m.id} m={m} index={i} />
          ))}
        </div>
      </div>
    </section>
  );
}

function MarkTag({ m, index }: { m: Mark; index: number }) {
  return (
    <div
      style={
        {
          width: 90,
          transform: `translate(${m.dx}px, ${m.dy}px) rotate(${m.rot}deg)`,
          ["--rot-start" as string]: `${m.rot - 6}deg`,
          ["--rot-end" as string]: `${m.rot}deg`,
          animation: index < 20 ? undefined : "drop-in 0.7s cubic-bezier(.4,1.6,.6,1) both",
        } as React.CSSProperties
      }
      className="relative shrink-0"
    >
      <svg
        viewBox="0 0 90 50"
        className="absolute inset-0 h-full w-full"
        style={{ overflow: "visible" }}
        aria-hidden
      >
        <path
          d="M 3 4 C 25 2, 60 6, 87 3 C 88 18, 86 32, 87 47 C 60 49, 25 46, 3 48 C 2 32, 4 18, 3 4 Z"
          fill="var(--parchment-deep)"
          stroke="var(--ink)"
          strokeOpacity="0.5"
          strokeWidth="0.8"
        />
      </svg>
      <div className="relative flex h-[50px] items-center px-3 py-2">
        <span
          className="block flex-1 truncate"
          style={{ color: "var(--ink)", fontSize: 10, fontWeight: 300, lineHeight: 1.2 }}
          title={m.name}
        >
          {m.name}
        </span>
        <span
          className="ml-1 inline-block shrink-0 rounded-full"
          style={{ width: 6, height: 6, backgroundColor: verdictColor(m.verdict) }}
          aria-label={m.verdict}
        />
      </div>
    </div>
  );
}

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
          EVIDENCE OVER ALGORITHM · MADE WITH CARE
        </p>
      </div>
    </footer>
  );
}

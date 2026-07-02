import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { CATEGORIES, TRENDS, trendBySlug } from "@/lib/trends";
import { getGeneratedTrendsMeta, getTrendingSearches } from "@/lib/generatedTrends.functions";

export const Route = createFileRoute("/")({
  loader: async () => {
    const [meta, trending] = await Promise.all([
      getGeneratedTrendsMeta(),
      getTrendingSearches(),
    ]);
    return { ...meta, trending };
  },
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

// Used to fill out the "trying now" row before enough real search volume
// has accumulated (or if Supabase is briefly unreachable).
const FALLBACK_TRENDING_SLUGS = ["rosemary-oil", "collagen-peptides", "ashwagandha", "slugging"];

function Veda() {
  const { count: generatedCount, trending } = Route.useLoaderData() as {
    count: number;
    trending: { slug: string; name: string }[];
  };

  const trendingRow = [
    ...trending,
    ...FALLBACK_TRENDING_SLUGS
      .filter((slug) => !trending.some((t) => t.slug === slug))
      .map((slug) => trendBySlug(slug))
      .filter((t): t is NonNullable<typeof t> => !!t)
      .map((t) => ({ slug: t.slug, name: t.name })),
  ].slice(0, 4);

  const [count, setCount] = useState<number>(TRENDS.length + generatedCount);
  const [query, setQuery] = useState("");
  const navigate = useNavigate();

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

    // Route to a freshly-generated card
    setCount((c) => c + 1);
    setQuery("");
    navigate({ to: "/search/$query", params: { query: q } });
  }

  return (
    <div className="min-h-screen" style={{ backgroundColor: "var(--parchment)" }}>
      <Nav />
      <Hero query={query} setQuery={setQuery} onSubmit={submit} count={count} trending={trendingRow} />
      <WavyDivider from="var(--parchment)" to="var(--ink)" />
      <Stats />
      <WavyDivider from="var(--ink)" to="var(--parchment)" />
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
      <div className="mx-auto flex max-w-[1400px] items-center justify-between gap-8 pl-4 pr-8 py-3 sm:py-5">
        <Link to="/" className="flex items-center gap-2">
          <span style={{ color: "var(--terracotta)", fontSize: 20, lineHeight: 1, display: "inline-flex", alignItems: "center", height: "34px" }}>◆</span>
          <span className="font-display text-[34px] leading-none" style={{ color: "var(--ink)" }}>
            veda
          </span>
          <span style={{ color: "var(--muted-ink)", fontFamily: "var(--font-display)", fontSize: 26, lineHeight: 1, display: "inline-flex", alignItems: "center", height: "34px", position: "relative", top: "4px" }}>
            वेदा
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
  trending,
}: {
  query: string;
  setQuery: (s: string) => void;
  onSubmit: (n?: string) => void;
  count: number;
  trending: { slug: string; name: string }[];
}) {
  return (
    <section className="relative">
      <div
        className="relative z-10 flex flex-col items-center justify-center px-4 pb-6 sm:pb-10"
        style={{ paddingTop: "clamp(1.25rem, 3.5vh, 4rem)" }}
      >
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
          className="font-display text-center leading-[0.95] mt-2 sm:mt-3"
          style={{
            fontSize: "clamp(34px, 9vw, 96px)",
            color: "var(--ink)",
            letterSpacing: "-0.02em",
            animation: "fade-up 1.2s ease-out 0.2s both",
          }}
        >
          Is it actually <span style={{ color: "var(--terracotta)" }}>worth it?</span>
        </h1>

        <p
          className="mt-3 sm:mt-5 max-w-xl text-center leading-snug"
          style={{
            color: "var(--ink)",
            fontSize: "clamp(13px, 3.4vw, 16px)",
            fontWeight: 300,
            animation: "fade-up 1.2s ease-out 0.6s both",
            whiteSpace: "pre-line",
          }}
        >
          Search any ingredient, product, or ritual.{"\u00a0"}{"\n"}
          We read the research papers and the Reddit threads so you don't have to.{"\n"}
        </p>

        <div
          className="relative mt-5 sm:mt-7"
          style={{
            width: "min(480px, 90vw)",
            animation: "fade-up 1.2s ease-out 1.0s both",
          }}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              onSubmit();
            }}
            className="group flex items-center gap-2 rounded-full px-4 py-3 shadow-[0_10px_30px_rgba(27,52,72,0.08)] transition-shadow"
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

        <div
          className="mt-4 sm:mt-6 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 px-4 text-center"
          style={{ animation: "fade-up 1.2s ease-out 1.4s both" }}
        >
          <span className="font-label" style={{ color: "var(--terracotta)", fontSize: 10 }}>
            TRENDING
          </span>
          {trending.map((t, i) => (
            <span key={t.slug} className="flex items-center gap-3">
              <Link
                to="/trend/$slug"
                params={{ slug: t.slug }}
                className="hover:opacity-60 transition-opacity"
                style={{ color: "var(--ink)", fontSize: "clamp(12px, 3.2vw, 15px)", fontWeight: 300 }}
              >
                {t.name.toLowerCase()}
              </Link>
              {i < trending.length - 1 && (
                <span style={{ color: "var(--muted-ink)", opacity: 0.5 }}>·</span>
              )}
            </span>
          ))}
        </div>

        <div
          className="mt-3 sm:mt-4 text-center font-display"
          style={{
            color: "var(--ink)",
            fontSize: "clamp(18px, 5vw, 26px)",
            animation: "fade-up 1.2s ease-out 1.6s both",
          }}
        >
          <CountUp value={count} duration={2400} /> trends verified
        </div>
      </div>
    </section>
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
      <svg viewBox="0 0 1440 60" preserveAspectRatio="none" className="w-full" style={{ height: "clamp(28px, 6vw, 60px)", display: "block" }}>
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
    <section style={{ backgroundColor: "var(--ink)" }} className="py-8 sm:py-14">
      <div className="mx-auto grid max-w-[1200px] grid-cols-3 gap-2 px-3 sm:gap-0 md:px-8">
        {stats.map((s, i) => (
          <div
            key={i}
            className="px-1.5 text-center sm:px-8"
            style={{
              borderLeft: i > 0 ? "0.5px solid color-mix(in oklab, var(--parchment) 25%, transparent)" : undefined,
            }}
          >
            <div
              className="font-display leading-none"
              style={{ color: "var(--parchment)", fontSize: `clamp(20px, 7vw, ${s.size}px)` }}
            >
              <StatCountUp text={s.num} />
            </div>
            <p
              className="mx-auto mt-2 sm:mt-5 max-w-[260px]"
              style={{
                color: "var(--parchment)",
                fontSize: "clamp(8.5px, 2.4vw, 13px)",
                fontWeight: 300,
                lineHeight: 1.35,
                opacity: 0.85,
              }}
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
          <span style={{ color: "var(--muted-ink)", fontFamily: "var(--font-display)" }} className="text-base">वेदा</span>
        </div>
        <p className="font-label" style={{ color: "var(--muted-ink)", fontSize: 10 }}>
          EVIDENCE OVER ALGORITHM · EST 2026
        </p>
      </div>
    </footer>
  );
}

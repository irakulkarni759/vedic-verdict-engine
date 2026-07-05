import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { CATEGORIES, TRENDS, trendBySlug } from "@/lib/trends";
import { getGeneratedTrendsMeta, getTrendingSearches } from "@/lib/generatedTrends.functions";
import { warmSentimentBackend } from "@/lib/reddit.server";

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
      { title: "Veda — Social media wellness, fact-checked." },
      {
        name: "description",
        content:
          "Your favorite influencer swears by rosemary oil, collagen, ashwagandha. We check what real science and real people say, and give you a straight verdict: backed, mixed, or debunked.",
      },
      { property: "og:title", content: "Veda — Social media wellness, fact-checked." },
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
  const [searchError, setSearchError] = useState<string | null>(null);
  const navigate = useNavigate();

  // Prewarm the sentiment backend on intent (page load, focusing the search
  // box) so it's awake by the time a search hits the loader — without paying
  // to keep Railway up 24/7. Throttled so repeated focus/typing can't spam it.
  const lastWarmRef = useRef(0);
  const prewarm = () => {
    const now = Date.now();
    if (now - lastWarmRef.current < 60_000) return;
    lastWarmRef.current = now;
    warmSentimentBackend().catch(() => {});
  };
  useEffect(() => {
    prewarm();
    // once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function updateQuery(v: string) {
    setQuery(v);
    if (searchError) setSearchError(null);
  }

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

    // Curated trends already have a purpose baked into their slug, but for
    // anything hitting the live pipeline we need the person to state one —
    // otherwise the verdict is guessing what they actually want to know.
    if (!/\bfor\b/i.test(q)) {
      setSearchError(`What's it for? Try "${q} for ___" so we know what to evaluate.`);
      return;
    }

    // Route to a freshly-generated card
    setSearchError(null);
    setCount((c) => c + 1);
    setQuery("");
    navigate({ to: "/search/$query", params: { query: q } });
  }

  return (
    <div className="flex min-h-dvh flex-col pt-6 sm:pt-12" style={{ backgroundColor: "var(--parchment)" }}>
      <Nav />
      <Hero query={query} setQuery={updateQuery} onSubmit={submit} onWarm={prewarm} count={count} trending={trendingRow} searchError={searchError} />
      <WavyDivider from="var(--parchment)" to="var(--ink)" />
      <Stats />
    </div>
  );
}

function Nav() {
  return (
    <nav
      className="sticky top-0 z-40 backdrop-blur-[2px]"
      style={{ backgroundColor: "color-mix(in oklab, var(--parchment) 92%, transparent)" }}
    >
      <div className="mx-auto max-w-[1400px]">
        <div className="flex items-center justify-between gap-8 pl-4 pr-8 py-4 sm:py-6">
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

        {/* Mobile-only: same category list as a horizontally scrollable strip
            under the logo row, since there's no room for it inline. */}
        <div
          className="flex md:hidden items-center gap-3 overflow-x-auto whitespace-nowrap px-4 pb-3 font-label"
          style={{ fontSize: 10, color: "var(--ink)" }}
        >
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
  onWarm,
  count,
  trending,
  searchError,
}: {
  query: string;
  setQuery: (s: string) => void;
  onSubmit: (n?: string) => void;
  onWarm: () => void;
  count: number;
  trending: { slug: string; name: string }[];
  searchError: string | null;
}) {
  return (
    <section className="relative">
      <div
        className="relative z-10 flex flex-col items-center justify-center px-4 pb-6 sm:pb-10"
        style={{ paddingTop: "clamp(2rem, 6vh, 6rem)" }}
      >
        <h1
          className="font-display text-center leading-[0.95]"
          style={{
            fontSize: "clamp(30px, 7.5vw, 76px)",
            color: "var(--ink)",
            letterSpacing: "-0.02em",
            animation: "fade-up 1.2s ease-out 0.2s both",
          }}
        >
          Social media wellness, <span style={{ color: "var(--terracotta)" }}>fact-checked.</span>
        </h1>

        <p
          className="mt-3 sm:mt-5 max-w-2xl text-center leading-snug"
          style={{
            color: "var(--ink)",
            fontSize: "clamp(13px, 3.4vw, 16px)",
            fontWeight: 300,
            animation: "fade-up 1.2s ease-out 0.6s both",
          }}
        >
          Your favorite influencer swears by rosemary oil for hair growth or collagen for bouncy skin. But does any of it actually work?
        </p>

        <p
          className="mt-3 max-w-xl text-center leading-snug"
          style={{
            color: "var(--muted-ink)",
            fontSize: "clamp(12px, 3vw, 14px)",
            fontWeight: 300,
            animation: "fade-up 1.2s ease-out 0.8s both",
          }}
        >
          We check what real science and real people say, not what an ad wants you to believe.
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
            style={{
              backgroundColor: "var(--parchment-deep)",
              outline: searchError ? "1.5px solid var(--verdict-debunked)" : undefined,
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ color: "var(--muted-ink)" }}>
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" strokeLinecap="round" />
            </svg>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onFocus={onWarm}
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

          {searchError ? (
            <p
              className="mt-3 text-center"
              style={{
                color: "var(--verdict-debunked)",
                fontSize: "clamp(10.5px, 2.6vw, 12px)",
                fontWeight: 400,
              }}
            >
              {searchError}
            </p>
          ) : (
            <p
              className="mt-3 text-center"
              style={{ color: "var(--muted-ink)", fontSize: "clamp(10.5px, 2.6vw, 12px)", fontWeight: 300, opacity: 0.8 }}
            >
              Type a specific claim below, like "rosemary oil for hair growth," not a general question.
            </p>
          )}
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
    <div style={{ backgroundColor: from, lineHeight: 0, marginBottom: -1 }}>
      <svg viewBox="0 0 1440 60" preserveAspectRatio="none" className="w-full" style={{ height: "clamp(36px, 6vw, 60px)", display: "block" }}>
        <path
          d="M0,30 C180,55 360,5 540,30 C720,55 900,5 1080,30 C1260,55 1440,5 1440,30 L1440,60 L0,60 Z"
          fill={to}
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
    <section style={{ backgroundColor: "var(--ink)" }} className="flex flex-1 items-center py-8 sm:py-14">
      <div className="mx-auto grid w-full max-w-[1200px] grid-cols-3 gap-2 px-3 sm:gap-0 md:px-8">
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


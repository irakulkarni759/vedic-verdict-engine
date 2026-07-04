import { useCallback, useEffect, useState } from "react";
import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { trendBySlug, type Trend, type Verdict } from "@/lib/trends";
import { getGeneratedTrendBySlug, persistTrendQuotes } from "@/lib/generatedTrends.functions";
import { startRedditQuoteJob, pollRedditQuoteJob, type ClaimJobPollResult } from "@/lib/reddit.server";
import { coreSubjectForReddit, pollUntil } from "@/lib/utils";
import { TrendCard } from "@/components/TrendCard";
import { Comments } from "@/components/Comments";

type Quote = { handle: string; text: string; url: string };

export const Route = createFileRoute("/trend/$slug")({
  loader: async ({ params }) => {
    const trend = trendBySlug(params.slug) ?? (await getGeneratedTrendBySlug({ data: { slug: params.slug } }));
    if (!trend) throw notFound();

    // Quotes are NOT fetched here anymore. The Reddit backend is slow to wake
    // and slow to scrape, so blocking the loader on it meant the whole page
    // sat blank until (often) a refresh caught the now-warm backend. Quotes
    // now stream in client-side after first paint (see CommunityQuotes), and
    // get persisted so it only happens once per trend.

    const related = trend.related
      .map((s) => trendBySlug(s))
      .filter((t): t is NonNullable<typeof t> => !!t);

    return { trend, related };
  },

  head: ({ loaderData }) => ({
    meta: loaderData
      ? [
          { title: `${loaderData.trend.name} — ${loaderData.trend.verdict} — Veda` },
          { name: "description", content: loaderData.trend.oneLiner },
          { property: "og:title", content: `${loaderData.trend.name} — ${loaderData.trend.verdict}` },
          { property: "og:description", content: loaderData.trend.oneLiner },
        ]
      : [],
  }),

  notFoundComponent: () => (
    <main className="min-h-screen px-6 py-10">
      <p className="font-label text-sm text-[var(--terracotta)]">NOT FOUND</p>
      <Link to="/" className="mt-4 inline-block text-sm underline">
        ← back to veda
      </Link>
    </main>
  ),

  component: TrendPage,
});

function verdictColor(v: Verdict) {
  return v === "BACKED"
    ? "var(--verdict-backed)"
    : v === "MIXED"
      ? "var(--verdict-mixed)"
      : "var(--verdict-debunked)";
}

function pubmedUrl(q: string) {
  return `https://pubmed.ncbi.nlm.nih.gov/?term=${encodeURIComponent(q)}`;
}

function redditUrl(q: string) {
  return `https://www.reddit.com/search/?q=${encodeURIComponent(q)}`;
}

function TrendPage() {
  const { trend, related } = Route.useLoaderData();
  // Lifted so CommunityQuotes can push a freshly-recomputed value up once it
  // finds real quotes — otherwise this text stays frozen at whatever generic
  // line was written when the trend was first generated with zero quotes.
  const [communityVerdict, setCommunityVerdict] = useState(trend.communityVerdict);
  const [sentiment, setSentiment] = useState(trend.sentiment);

  // TrendPage doesn't remount across navigations to a different slug (only
  // the loader data changes), so this state needs an explicit resync or a
  // stale value from a previously-viewed trend would leak into this one.
  useEffect(() => {
    setCommunityVerdict(trend.communityVerdict);
    setSentiment(trend.sentiment);
  }, [trend.slug, trend.communityVerdict, trend.sentiment]);

  // Stable reference — passed into CommunityQuotes' effect dependency array,
  // so an inline arrow here would re-fire that effect (and re-fetch) every
  // time this callback runs and re-renders the parent.
  const handleVerdictUpdate = useCallback((cv: string, s: number) => {
    setCommunityVerdict(cv);
    setSentiment(s);
  }, []);

  return (
    <main className="min-h-screen bg-[var(--parchment)] px-5 py-8 sm:px-8 sm:py-10">
      <div className="mx-auto max-w-[1120px]">
        <Link
          to="/"
          className="font-label mb-6 inline-block text-xs text-[var(--muted-ink)] transition hover:text-[var(--terracotta)]"
        >
          ← BACK TO VEDA
        </Link>

        <section className="rounded-[26px] border border-white/70 bg-[linear-gradient(135deg,#fff_0%,#fbf4e8_100%)] p-6 shadow-[0_22px_70px_rgba(27,52,72,0.08)] sm:p-8">
          <div className="mb-5 flex items-start justify-between gap-4">
            <p className="font-label text-xs text-[var(--muted-ink)]">
              {trend.category.replace("-", " ").toUpperCase()}
            </p>

            <div
              className="font-label rounded-full border px-4 py-2 text-xs"
              style={{
                color: verdictColor(trend.verdict),
                borderColor: "color-mix(in oklab, currentColor 45%, transparent)",
                backgroundColor: "color-mix(in oklab, currentColor 10%, transparent)",
              }}
            >
              • {trend.verdict}
            </div>
          </div>

          <h1 className="font-display max-w-4xl text-4xl leading-[0.95] tracking-[-0.04em] text-[var(--ink)] sm:text-5xl md:text-6xl">
            {trend.name}
          </h1>

          <HeroSummary
            researchVerdict={trend.oneLiner}
            communityVerdict={communityVerdict}
            safetyNote={trend.safetyNote}
          />
        </section>

        <section className="mt-8">
          <SectionHeader
            left="WHAT THE RESEARCH SAYS"
            right={`ALL ${trend.studies} ON PUBMED ↗`}
            href={pubmedUrl(trend.name)}
          />

          <div className="mt-4 space-y-3">
            {trend.evidence.map((e: string, i: number) => (
              <article
                key={e}
                className="grid gap-4 rounded-[22px] border border-white/75 bg-white/90 p-7 shadow-[0_12px_35px_rgba(27,52,72,0.04)] sm:grid-cols-[48px_1fr] sm:p-8"
              >
                <div className="font-mono text-sm text-[var(--sage)]">
                  {String(i + 1).padStart(2, "0")}
                </div>

                <div>
                  <p className="text-lg leading-8 text-[var(--ink)]">{e}</p>

                  <a
                    href={trend.sourceUrls[i] ?? pubmedUrl(trend.name)}
                    target="_blank"
                    rel="noreferrer"
                    className="font-mono mt-5 inline-block text-xs text-[var(--terracotta)]"
                  >
                    view on pubmed ↗
                  </a>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="mt-8">
          <SectionHeader
            left="WHAT PEOPLE SAY"
            right="READ THREADS ON REDDIT ↗"
            href={redditUrl(trend.name)}
          />

          <article className="mt-4 rounded-[22px] border border-white/75 bg-white/90 p-8 shadow-[0_12px_35px_rgba(27,52,72,0.04)]">
            <div className="mb-5 flex items-center justify-between gap-4">
              <p className="font-label text-xs text-[var(--muted-ink)]">
                COMMUNITY SENTIMENT
              </p>

              <p className="font-mono text-sm text-[var(--verdict-mixed)]">
                {sentiment}% positive
              </p>
            </div>

            <div className="h-2 overflow-hidden rounded-full bg-[var(--parchment-deep)]">
              <div
                className="h-full rounded-full bg-[var(--verdict-mixed)]"
                style={{ width: `${sentiment}%` }}
              />
            </div>

            <CommunityQuotes
              key={trend.slug}
              slug={trend.slug}
              searchQuery={trend.query ?? trend.name}
              initialQuotes={trend.quotes}
              name={trend.name}
              researchSummary={trend.oneLiner}
              existingSentiment={trend.sentiment}
              onVerdictUpdate={handleVerdictUpdate}
            />
          </article>
        </section>

        <Comments slug={trend.slug} />

        {related.length > 0 && (
          <section className="mt-14">
            <p className="font-label mb-4 text-xs text-[var(--sage)]">
              RELATED TRENDS
            </p>

            <div className="grid gap-4 md:grid-cols-3">
              {related.map((r: Trend) => (
                <TrendCard key={r.slug} trend={r} compact />
              ))}
            </div>
          </section>
        )}
      </div>
    </main>
  );
}

/**
 * Community quotes, fetched client-side after first paint instead of in the
 * blocking loader. If the trend already has quotes on file, they render
 * instantly. If not, we fetch them live (the Reddit backend can be slow to
 * wake), show a loading state meanwhile, and persist whatever comes back so
 * the next visit is instant. Nothing here ever blocks the rest of the page.
 */
function CommunityQuotes({
  slug,
  searchQuery,
  initialQuotes,
  name,
  researchSummary,
  existingSentiment,
  onVerdictUpdate,
}: {
  slug: string;
  searchQuery: string;
  initialQuotes: Quote[];
  name: string;
  researchSummary: string;
  existingSentiment: number;
  onVerdictUpdate: (communityVerdict: string, sentiment: number) => void;
}) {
  const [quotes, setQuotes] = useState<Quote[]>(initialQuotes);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // Second guard beyond the initialQuotes check: once this effect has
    // already found and set real quotes, never re-fetch even if it re-runs
    // for some other dependency reason.
    if (initialQuotes.length > 0 || quotes.length > 0) return;
    let cancelled = false;
    setLoading(true);

    (async () => {
      const start = await startRedditQuoteJob({ data: { query: coreSubjectForReddit(searchQuery) } });
      if (cancelled) return;

      // A cache hit resolves instantly ("done"). Otherwise poll a cheap
      // status endpoint every few seconds — up to ~3 minutes — instead of
      // holding one request open, so a slow scrape gets the time it
      // actually needs rather than a premature "nothing found."
      const final: ClaimJobPollResult =
        start.status === "pending"
          ? await pollUntil<ClaimJobPollResult>(
              () => pollRedditQuoteJob({ data: { jobId: start.jobId } }),
              (r) => r.status === "pending",
              { intervalMs: 4000, maxAttempts: 45, isCancelled: () => cancelled },
            )
          : start;

      if (cancelled) return;
      setLoading(false);
      if (final.status !== "done" || final.quotes.length === 0) return;

      setQuotes(final.quotes);
      // Persist AND recompute the community verdict/sentiment from these
      // specific quotes — saving the quotes alone left the summary text
      // frozen at whatever generic line was written when generation first
      // ran with zero quotes.
      persistTrendQuotes({
        data: { slug, name, summary: researchSummary, existingSentiment, quotes: final.quotes },
      })
        .then((res) => {
          if (!cancelled && res.ok && res.communityVerdict && typeof res.sentiment === "number") {
            onVerdictUpdate(res.communityVerdict, res.sentiment);
          }
        })
        .catch(() => {});
    })();

    return () => {
      cancelled = true;
    };
  }, [slug, searchQuery, initialQuotes.length, quotes.length, name, researchSummary, existingSentiment, onVerdictUpdate]);

  if (quotes.length === 0) {
    return (
      <p className="font-mono mt-8 text-xs text-[var(--muted-ink)]">
        {loading ? "Gathering community reactions…" : "No community reactions found for this one yet."}
      </p>
    );
  }

  return (
    <div className="mt-8 space-y-8">
      {quotes.map((q) => (
        <div key={`${q.handle}-${q.text}`}>
          <p className="text-lg italic leading-8 text-[var(--ink)]">“{q.text}”</p>

          <a
            href={q.url}
            target="_blank"
            rel="noreferrer"
            className="font-mono mt-3 inline-block text-xs text-[var(--terracotta)]"
          >
            {q.handle.toUpperCase()} ↗
          </a>
        </div>
      ))}
    </div>
  );
}

/**
 * Two-line hero summary: one line on what the research found, one on
 * community sentiment — instead of a single generic sentence. Falls back
 * to a single line when there's no separate community verdict (e.g.
 * unmapped/pharma results with nothing to summarize yet).
 */
function HeroSummary({
  researchVerdict,
  communityVerdict,
  safetyNote,
}: {
  researchVerdict: string;
  communityVerdict: string;
  safetyNote: string;
}) {
  if (!communityVerdict) {
    return (
      <p className="mt-4 max-w-3xl text-base leading-7 text-[var(--ink)] sm:text-lg">
        {researchVerdict}
      </p>
    );
  }

  return (
    <div className="mt-4 max-w-3xl space-y-3.5">
      <div>
        <p className="font-label text-[10px] text-[var(--sage)]">RESEARCH</p>
        <p className="mt-1 text-base leading-7 text-[var(--ink)] sm:text-lg">{researchVerdict}</p>
      </div>
      <div>
        <p className="font-label text-[10px] text-[var(--sage)]">COMMUNITY</p>
        <p className="mt-1 text-base leading-7 text-[var(--ink)] sm:text-lg">{communityVerdict}</p>
      </div>
      {safetyNote && (
        <div className="flex gap-2 rounded-[14px] px-4 py-3" style={{ backgroundColor: "color-mix(in oklab, var(--verdict-mixed) 10%, transparent)" }}>
          <span className="shrink-0" style={{ color: "var(--verdict-mixed)", fontSize: 15, lineHeight: "24px" }}>⚠</span>
          <p className="text-sm leading-6" style={{ color: "var(--ink)" }}>
            <span className="font-label mr-1.5 text-[10px]" style={{ color: "var(--verdict-mixed)" }}>SAFETY</span>
            {safetyNote}
          </p>
        </div>
      )}
    </div>
  );
}

function SectionHeader({
  left,
  right,
  href,
}: {
  left: string;
  right: string;
  href: string;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <p className="font-label text-xs text-[var(--sage)]">{left}</p>

      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className="font-label text-xs text-[var(--terracotta)] transition hover:opacity-70"
      >
        {right}
      </a>
    </div>
  );
}

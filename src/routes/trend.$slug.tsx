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

  head: ({ params, loaderData }) => ({
    meta: loaderData
      ? [
          { title: `${loaderData.trend.name} — ${loaderData.trend.verdict} — Veda` },
          { name: "description", content: loaderData.trend.oneLiner },
          { property: "og:title", content: `${loaderData.trend.name} — ${loaderData.trend.verdict}` },
          { property: "og:description", content: loaderData.trend.oneLiner },
          { property: "og:type", content: "article" },
          { property: "og:url", content: `https://askveda.app/trend/${params.slug}` },
          { name: "twitter:card", content: "summary" },
          { name: "twitter:title", content: `${loaderData.trend.name} — ${loaderData.trend.verdict}` },
          { name: "twitter:description", content: loaderData.trend.oneLiner },
        ]
      : [],
    links: [{ rel: "canonical", href: `https://askveda.app/trend/${params.slug}` }],
    scripts: loaderData
      ? [
          {
            type: "application/ld+json",
            children: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "Article",
              headline: `${loaderData.trend.name} — ${loaderData.trend.verdict}`,
              description: loaderData.trend.oneLiner,
              url: `https://askveda.app/trend/${params.slug}`,
              about: loaderData.trend.name,
              publisher: { "@type": "Organization", name: "Veda" },
            }),
          },
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
  const { trend, related } = Route.useLoaderData() as { trend: Trend; related: Trend[] };
  // Lifted so CommunityQuotes can push a freshly-recomputed value up once it
  // finds real quotes — otherwise this text stays frozen at whatever generic
  // line was written when the trend was first generated with zero quotes.
  const [communityVerdict, setCommunityVerdict] = useState(trend.communityVerdict);
  const [communityGist, setCommunityGist] = useState<string[] | null>(null);
  const [sentiment, setSentiment] = useState(trend.sentiment);
  // Whether any real quotes are on screen — the sentiment % is only shown
  // when this is true, since a % with zero discussion behind it is invented.
  const [hasQuotes, setHasQuotes] = useState((trend.quotes?.length ?? 0) > 0);
  // Cards show the plain-English "text" by default; clicking reveals the
  // fuller "detail". Keyed by index, reset below on slug change for the
  // same reason communityVerdict/sentiment are — this component doesn't
  // remount across navigations, so stale expand state from a previously-
  // viewed trend would otherwise leak into this one. Auto-open when
  // there's only ONE card total — see search.$query.tsx for why.
  const [expandedBullets, setExpandedBullets] = useState<Set<number>>(
    trend.bullets?.length === 1 ? new Set([0]) : new Set(),
  );

  function toggleBullet(i: number) {
    setExpandedBullets((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }

  // TrendPage doesn't remount across navigations to a different slug (only
  // the loader data changes), so this state needs an explicit resync or a
  // stale value from a previously-viewed trend would leak into this one.
  useEffect(() => {
    setCommunityVerdict(trend.communityVerdict);
    setCommunityGist(null);
    setSentiment(trend.sentiment);
    setHasQuotes((trend.quotes?.length ?? 0) > 0);
    setExpandedBullets(trend.bullets?.length === 1 ? new Set([0]) : new Set());
  }, [trend.slug, trend.communityVerdict, trend.sentiment, trend.quotes?.length]);

  // Stable reference — passed into CommunityQuotes' effect dependency array,
  // so an inline arrow here would re-fire that effect (and re-fetch) every
  // time this callback runs and re-renders the parent.
  const handleVerdictUpdate = useCallback((cv: string, s: number, gist: string[] | null) => {
    setCommunityVerdict(cv);
    setCommunityGist(gist);
    setSentiment(s);
  }, []);

  const handleQuotesFound = useCallback(() => setHasQuotes(true), []);

  // Publication year per bullet, looked up by the bullet's article url —
  // available for generated trends whose articles list was cached;
  // curated trends (no articles) simply show no year chip.
  const yearByUrl = new Map((trend.articles ?? []).map((a) => [a.url, a.year]));
  const articleYear = (url: string): string | null => {
    const y = yearByUrl.get(url);
    return y && /^\d{4}$/.test(y) ? y : null;
  };

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
              className="font-label rounded-full border px-5 py-2.5 text-base"
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
            researchGist={trend.researchGist ?? []}
            communityVerdict={communityVerdict}
            communityGist={
              communityGist ??
              (communityVerdict === trend.communityVerdict
                ? // Drop a stale "Limited discussion found" gist once real
                  // quotes are on screen — it's provably wrong at that point.
                  (trend.communityGist ?? []).filter(
                    (g) => !hasQuotes || !/limited (public )?discussion|no (real )?discussion/i.test(g),
                  )
                : [])
            }
            safetyNote={trend.safetyNote}
          />

          <div>
            <ShareButton title={`${trend.name} — ${trend.verdict} on Veda`} text={trend.oneLiner} />
          </div>
        </section>

        <section className="mt-8">
          <SectionHeader
            left="WHAT THE RESEARCH SAYS"
            right={`ALL ${trend.studies} ON PUBMED ↗`}
            href={pubmedUrl(trend.name)}
          />

          {trend.bullets && trend.bullets.length > 0 ? (
            <>
              {/* Study-count banner — same as search.$query.tsx. */}
              <div
                className="mt-3 inline-flex items-center gap-2 rounded-full px-3.5 py-1.5"
                style={{ backgroundColor: "color-mix(in oklab, var(--sage) 10%, transparent)" }}
              >
                <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ backgroundColor: "var(--sage)" }} />
                <span className="font-label text-[10px]" style={{ color: "var(--sage)" }}>
                  BASED ON {trend.studies} PUBMED {trend.studies === 1 ? "STUDY" : "STUDIES"}
                </span>
              </div>

              {trend.bullets.some((b) => b.isIngredient) && (
                <p className="mt-2 font-mono text-xs" style={{ color: "var(--muted-ink)" }}>
                  Cards marked "FROM INGREDIENT LIST" below are separate PubMed searches on {trend.name}'s
                  individual key ingredients, not the product itself — PubMed rarely indexes research on a
                  specific commercial product by name.
                </p>
              )}

              <div className="mt-4 space-y-3">
                {trend.bullets.map((b, i) => {
                  const isOpen = expandedBullets.has(i);
                  return (
                    <article
                      key={i}
                      onClick={() => toggleBullet(i)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          toggleBullet(i);
                        }
                      }}
                      aria-expanded={isOpen}
                      className="grid cursor-pointer gap-4 rounded-[22px] border border-white/75 bg-white/90 p-7 shadow-[0_12px_35px_rgba(27,52,72,0.04)] transition hover:border-[var(--terracotta)]/40 sm:grid-cols-[48px_1fr] sm:p-8"
                    >
                      <div className="font-mono text-sm text-[var(--sage)]">
                        {String(i + 1).padStart(2, "0")}
                      </div>

                      <div>
                        <div className="mb-2 flex flex-wrap items-center gap-1.5">
                          {b.isIngredient && (
                            <span
                              className="font-label rounded-full px-2 py-0.5 text-[9px]"
                              style={{ color: "var(--sage)", backgroundColor: "color-mix(in oklab, var(--sage) 10%, transparent)" }}
                            >
                              FROM INGREDIENT LIST
                            </span>
                          )}
                          <span
                            className="font-label rounded-full px-2 py-0.5 text-[9px]"
                            style={{ color: "var(--muted-ink)", backgroundColor: "color-mix(in oklab, var(--ink) 6%, transparent)" }}
                          >
                            {b.studyType.toUpperCase()}
                          </span>
                          {articleYear(b.url) && (
                            <span
                              className="font-label rounded-full px-2 py-0.5 text-[9px]"
                              style={{ color: "var(--muted-ink)", backgroundColor: "color-mix(in oklab, var(--ink) 6%, transparent)" }}
                            >
                              PUBLISHED {articleYear(b.url)}
                            </span>
                          )}
                          {b.limitations && (
                            <span
                              className="font-label inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px]"
                              style={{
                                color: "var(--verdict-mixed)",
                                backgroundColor: "color-mix(in oklab, var(--verdict-mixed) 10%, transparent)",
                              }}
                            >
                              ⚠ {b.limitations.toUpperCase()}
                            </span>
                          )}
                        </div>

                        <p className="text-lg leading-8 text-[var(--ink)]">{b.text}</p>

                        {isOpen && (
                          <div className="mt-4 rounded-[14px] bg-[var(--parchment)] px-4 py-3.5">
                            <p className="font-label mb-1.5 text-[10px] text-[var(--sage)]">
                              THE RESEARCH DETAIL
                            </p>
                            <p className="font-mono text-sm leading-6 text-[var(--muted-ink)]">
                              {b.detail}
                            </p>
                          </div>
                        )}

                        <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleBullet(i);
                            }}
                            className="font-label text-xs text-[var(--sage)] transition hover:opacity-70"
                          >
                            {isOpen ? "HIDE DETAIL ↑" : "SHOW RESEARCH DETAIL ↓"}
                          </button>

                          <a
                            href={b.url}
                            target="_blank"
                            rel="noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="font-mono inline-block text-xs text-[var(--terracotta)]"
                          >
                            view on pubmed ↗
                          </a>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            </>
          ) : (
            // Fallback for curated trends and rows generated before rich
            // bullets existed — plain text, no badges/detail-toggle/banner,
            // since that data was never captured for these.
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
          )}
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

              {/* Only claim a % when real quotes back it up — a bar with no
                  discussion behind it was pure invention. */}
              {hasQuotes ? (
                <p className="font-mono text-sm text-[var(--verdict-mixed)]">
                  {sentiment}% positive
                </p>
              ) : (
                <p className="font-mono text-sm text-[var(--muted-ink)]">
                  gathering data…
                </p>
              )}
            </div>

            {hasQuotes && (
              <div className="h-2 overflow-hidden rounded-full bg-[var(--parchment-deep)]">
                <div
                  className="h-full rounded-full bg-[var(--verdict-mixed)]"
                  style={{ width: `${sentiment}%` }}
                />
              </div>
            )}

            <CommunityQuotes
              key={trend.slug}
              slug={trend.slug}
              searchQuery={trend.query ?? trend.name}
              initialQuotes={trend.quotes}
              name={trend.name}
              researchSummary={trend.oneLiner}
              existingSentiment={trend.sentiment}
              onVerdictUpdate={handleVerdictUpdate}
              onQuotesFound={handleQuotesFound}
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
 * Share this verdict card: native share sheet where the browser supports
 * it, clipboard-copy fallback everywhere else. The link unfurls with the
 * verdict + one-liner via the route's og/twitter meta. Duplicated in
 * search.$query.tsx — these route files intentionally don't share
 * presentational components.
 */
function ShareButton({ title, text }: { title: string; text: string }) {
  const [copied, setCopied] = useState(false);

  async function share() {
    const url = window.location.href;
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title, text, url });
        return;
      } catch {
        // user dismissed the sheet, or share failed — fall through to copy
      }
    }
    let ok = false;
    try {
      await navigator.clipboard.writeText(url);
      ok = true;
    } catch {
      // Clipboard API blocked (permissions/iframe) — legacy fallback.
      try {
        const ta = document.createElement("textarea");
        ta.value = url;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        ok = document.execCommand("copy");
        ta.remove();
      } catch {
        ok = false;
      }
    }
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  return (
    <button
      type="button"
      onClick={share}
      className="font-label mt-6 inline-flex items-center gap-2 rounded-full border px-4 py-2 text-xs transition hover:opacity-70"
      style={{
        color: "var(--terracotta)",
        borderColor: "color-mix(in oklab, var(--terracotta) 45%, transparent)",
        backgroundColor: "color-mix(in oklab, var(--terracotta) 8%, transparent)",
      }}
    >
      {copied ? "LINK COPIED ✓" : "SHARE THIS VERDICT ↗"}
    </button>
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
  onQuotesFound,
}: {
  slug: string;
  searchQuery: string;
  initialQuotes: Quote[];
  name: string;
  researchSummary: string;
  existingSentiment: number;
  onVerdictUpdate: (communityVerdict: string, sentiment: number, gist: string[] | null) => void;
  onQuotesFound: () => void;
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
      onQuotesFound();
      // Persist AND recompute the community verdict/sentiment from these
      // specific quotes — saving the quotes alone left the summary text
      // frozen at whatever generic line was written when generation first
      // ran with zero quotes.
      persistTrendQuotes({
        data: {
          slug,
          name,
          summary: researchSummary,
          existingSentiment,
          quotes: final.quotes,
          backendSentiment: final.sentiment.score,
        },
      })
        .then((res) => {
          if (!cancelled && res.ok && res.communityVerdict && typeof res.sentiment === "number") {
            onVerdictUpdate(res.communityVerdict, res.sentiment, res.communityGist ?? null);
          }
        })
        .catch(() => {});
    })();

    return () => {
      cancelled = true;
    };
  }, [slug, searchQuery, initialQuotes.length, quotes.length, name, researchSummary, existingSentiment, onVerdictUpdate, onQuotesFound]);

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
  researchGist,
  communityVerdict,
  communityGist,
  safetyNote,
}: {
  researchVerdict: string;
  researchGist: string[];
  communityVerdict: string;
  communityGist: string[];
  safetyNote: string;
}) {
  const researchItems = researchGist.length > 0 ? researchGist : researchVerdict ? [researchVerdict] : [];
  const communityItems = communityGist.length > 0 ? communityGist : communityVerdict ? [communityVerdict] : [];

  return (
    <>
      <div className="mt-4 max-w-3xl space-y-4">
        {researchItems.length > 0 && (
          <div>
            <p className="font-label text-[10px] text-[var(--sage)]">RESEARCH</p>
            <GistList items={researchItems} color="var(--sage)" />
          </div>
        )}
        {communityItems.length > 0 && (
          <div>
            <p className="font-label text-[10px] text-[var(--terracotta)]">COMMUNITY</p>
            <GistList items={communityItems} color="var(--terracotta)" />
          </div>
        )}
      </div>
      {safetyNote && (
        <div
          className="mt-3.5 inline-flex w-fit max-w-[92vw] lg:max-w-none gap-2 rounded-[14px] px-4 py-3"
          style={{ backgroundColor: "color-mix(in oklab, var(--verdict-mixed) 10%, transparent)" }}
        >
          <span className="shrink-0" style={{ color: "var(--verdict-mixed)", fontSize: 15, lineHeight: "24px" }}>⚠</span>
          <p className="text-sm leading-6 whitespace-normal lg:whitespace-nowrap" style={{ color: "var(--ink)" }}>
            <span className="font-label mr-1.5 text-[10px]" style={{ color: "var(--verdict-mixed)" }}>SAFETY</span>
            {safetyNote}
          </p>
        </div>
      )}
    </>
  );
}

/**
 * Renders either a set of short, skimmable gist fragments ("Reduces fine
 * lines", "Takes 8+ weeks") or, when there's no gist data yet (older cached
 * rows, curated trends written before this existed), a single full-sentence
 * bullet as a graceful fallback — same bullet-list look either way.
 */
function GistList({ items, color }: { items: string[]; color: string }) {
  return (
    <ul className="mt-2 space-y-1.5">
      {items.map((item, i) => (
        <li key={i} className="flex gap-2.5">
          <span
            className="mt-[9px] inline-block h-1 w-1 shrink-0 rounded-full"
            style={{ backgroundColor: color }}
          />
          <span className="text-base leading-7 text-[var(--ink)] sm:text-lg">{item}</span>
        </li>
      ))}
    </ul>
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

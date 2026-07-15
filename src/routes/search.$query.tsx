import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { TRENDS } from "@/lib/trends";
import { TrendCard } from "@/components/TrendCard";
import { Comments } from "@/components/Comments";
import { toTitleCase, coreSubjectForReddit, pollUntil } from "@/lib/utils";
import {
  startRedditQuoteJob,
  pollRedditQuoteJob,
  type RedditQuote,
  type ClaimJobPollResult,
} from "@/lib/reddit.server";
import { persistTrendQuotes } from "@/lib/generatedTrends.functions";
import {
  generateEvidenceVerdict,
  type EvidenceVerdict,
} from "@/lib/evidence.functions";

export const Route = createFileRoute("/search/$query")({
  component: SearchPage,
  loader: ({ params }) =>
    generateEvidenceVerdict({
      data: { query: decodeURIComponent(params.query) },
    }),
  pendingComponent: PendingPage,
  errorComponent: ({ error }) => (
    <div
      className="min-h-screen p-10"
      style={{ backgroundColor: "var(--parchment)" }}
    >
      <p className="font-mono text-sm" style={{ color: "var(--ink)" }}>
        Couldn't generate verdict: {error.message}
      </p>
    </div>
  ),
});

function verdictColor(v: EvidenceVerdict["verdict"]) {
  return v === "BACKED"
    ? "var(--verdict-backed)"
    : v === "DEBUNKED"
      ? "var(--verdict-debunked)"
      : v === "MIXED"
        ? "var(--verdict-mixed)"
        : "var(--muted-ink)";
}

function PendingPage() {
  const { query } = Route.useParams();
  const q = decodeURIComponent(query);

  return (
    <div
      className="min-h-screen pb-24"
      style={{ backgroundColor: "var(--parchment)" }}
    >
      <div className="mx-auto max-w-[1120px] px-6 pt-8">
        <Link
          to="/"
          className="font-label text-xs hover:opacity-70"
          style={{ color: "var(--muted-ink)" }}
        >
          ← BACK TO VEDA
        </Link>

        <div className="mt-6 rounded-[30px] border border-white/70 bg-[linear-gradient(135deg,#fff_0%,#fbf4e8_100%)] p-8 shadow-[0_22px_70px_rgba(27,52,72,0.08)] sm:p-12">
          <p
            className="font-label text-xs"
            style={{ color: "var(--muted-ink)" }}
          >
            GATHERING EVIDENCE
          </p>

          <h1 className="font-display mt-3 text-5xl leading-[0.95] tracking-[-0.04em] text-[var(--ink)] sm:text-7xl md:text-8xl">
            {toTitleCase(q)}
          </h1>

          <p
            className="mt-4 font-mono text-xs"
            style={{ color: "var(--muted-ink)" }}
          >
            Searching PubMed for clinical evidence…
          </p>

          <div
            className="mt-6 h-2 w-full overflow-hidden rounded-full"
            style={{
              backgroundColor:
                "color-mix(in oklab, var(--ink) 8%, transparent)",
            }}
          >
            <div
              className="h-full w-1/3 animate-pulse"
              style={{ backgroundColor: "var(--terracotta)" }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function SearchPage() {
  const data = Route.useLoaderData() as EvidenceVerdict;
  const { query } = Route.useParams();
  const q = decodeURIComponent(query);
  const color = verdictColor(data.verdict);

  // Warm searches already carry the scraped quotes + the summary written from
  // them straight out of the loader — they render together with the research,
  // done. This effect ONLY covers the cold-first-search case: the loader's
  // scrape didn't finish in its budget (a stone-cold Railway container that
  // prewarm hadn't fully woken yet), so the page shows research + the snapshot
  // card, and this quietly finishes the scrape in the background and drops the
  // real quotes AND the corrected summary in place — so the user never has to
  // reload by hand to see them. Warm path: data.quotes is already populated, so
  // the guard below returns immediately and nothing extra runs.
  const [liveQuotes, setLiveQuotes] = useState<RedditQuote[] | null>(null);
  const [liveCommunityVerdict, setLiveCommunityVerdict] = useState<string | null>(null);
  const [liveCommunityGist, setLiveCommunityGist] = useState<string[] | null>(null);
  const [liveSentiment, setLiveSentiment] = useState<number | null>(null);
  // Cards show the plain-English "text" by default; clicking reveals the
  // fuller, more technical "detail" for that same finding. Keyed by index
  // since bullets don't have a stable id. Auto-open when there's only ONE
  // card total — most often a branded product's folded ingredient summary,
  // where the real substance (per-ingredient study type/limitations) lives
  // in the detail panel; with a single card, requiring an extra click just
  // to see any of that made the whole section look thin/empty at a glance.
  const [expandedBullets, setExpandedBullets] = useState<Set<number>>(
    data.bullets.length === 1 ? new Set([0]) : new Set(),
  );

  function toggleBullet(i: number) {
    setExpandedBullets((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }

  useEffect(() => {
    setLiveQuotes(null);
    setLiveCommunityVerdict(null);
    setLiveCommunityGist(null);
    setLiveSentiment(null);

    const noVerdict =
      data.verdict === "PHARMA" || data.verdict === "UNKNOWN" || data.studies === 0;
    if (data.quotes.length > 0 || !data.query || noVerdict) return;

    let cancelled = false;
    (async () => {
      const start = await startRedditQuoteJob({
        data: { query: coreSubjectForReddit(data.query) },
      });
      if (cancelled) return;

      // Railway usually has the result cached from the loader's own attempt
      // (which warmed it), so this often resolves "done" on the first call;
      // otherwise poll a cheap status route until it lands.
      const final: ClaimJobPollResult =
        start.status === "pending"
          ? await pollUntil<ClaimJobPollResult>(
              () => pollRedditQuoteJob({ data: { jobId: start.jobId } }),
              (r) => r.status === "pending",
              { intervalMs: 3000, maxAttempts: 30, isCancelled: () => cancelled },
            )
          : start;

      if (cancelled || final.status !== "done" || final.quotes.length === 0) return;
      setLiveQuotes(final.quotes);
      // The job payload carries the backend's full-pool sentiment score —
      // surface it immediately rather than waiting on the persist round-trip.
      if (typeof final.sentiment.score === "number") setLiveSentiment(final.sentiment.score);

      // Recompute the summary from these specific quotes and persist, so the
      // stored row + this page both catch up from the generic first-pass line.
      const res = await persistTrendQuotes({
        data: {
          slug: data.slug,
          name: data.name,
          summary: data.oneLiner,
          existingSentiment: data.sentiment,
          quotes: final.quotes,
          backendSentiment: final.sentiment.score,
        },
      }).catch(() => null);

      if (!cancelled && res?.ok && res.communityVerdict && typeof res.sentiment === "number") {
        setLiveCommunityVerdict(res.communityVerdict);
        setLiveCommunityGist(res.communityGist ?? null);
        setLiveSentiment(res.sentiment);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [data.query, data.quotes.length, data.slug, data.name, data.oneLiner, data.sentiment, data.verdict, data.studies]);

  const displayQuotes = data.quotes.length > 0 ? data.quotes : liveQuotes ?? [];
  const displayCommunityVerdict = liveCommunityVerdict ?? data.communityVerdict;
  const displaySentiment = liveSentiment ?? data.sentiment;

  // Never let a stale "Limited discussion found" gist (cached when the
  // first scrape missed its window) sit above real quotes that have since
  // loaded — if quotes are on screen, that phrase is provably wrong.
  const staleNoDiscussion = (s: string) => /limited (public )?discussion|no (real )?discussion/i.test(s);
  const baseCommunityGist =
    displayQuotes.length > 0 ? data.communityGist.filter((g) => !staleNoDiscussion(g)) : data.communityGist;
  const displayCommunityGist = liveCommunityGist ?? (liveCommunityVerdict == null ? baseCommunityGist : []);

  const tokens = q
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 2);

  const related = TRENDS.filter((t) =>
    tokens.some(
      (tok) =>
        t.name.toLowerCase().includes(tok) || t.slug.includes(tok),
    ),
  ).slice(0, 3);

  const isPharma = data.verdict === "PHARMA";
  // A branded product's raw name almost never has direct PubMed hits (that's
  // the whole reason the ingredient-breakdown fallback exists) — data.studies
  // === 0 at the top level doesn't mean there's nothing to show, it's the
  // NORMAL case for products. Treating that as "unknown" was hiding the
  // entire community/quotes section (and mislabeling the page "NOT YET
  // INDEXED"/"PENDING REVIEW") even when real ingredient research and real
  // Reddit discussion were both found — exactly backwards for the most
  // common branded-product case.
  const hasIngredientData = (data.ingredientBreakdown?.length ?? 0) > 0;
  const isUnknown = !isPharma && !hasIngredientData && (data.verdict === "UNKNOWN" || data.studies === 0);

  return (
    <main className="min-h-screen bg-[var(--parchment)] px-5 py-8 sm:px-8 sm:py-10">
      <div className="mx-auto max-w-[1120px]">
        <Link
          to="/"
          className="font-label mb-6 inline-block text-xs text-[var(--muted-ink)] transition hover:text-[var(--terracotta)]"
        >
          ← BACK TO VEDA
        </Link>

        {/* ── HERO CARD ── */}
        <section className="rounded-[26px] border border-white/70 bg-[linear-gradient(135deg,#fff_0%,#fbf4e8_100%)] p-6 shadow-[0_22px_70px_rgba(27,52,72,0.08)] sm:p-8">
          <div className="mb-5 flex items-start justify-between gap-4">
            <p className="font-label text-xs text-[var(--muted-ink)]">
              {isPharma
                ? "OUTSIDE OUR SCOPE"
                : isUnknown
                  ? "NOT YET INDEXED"
                  : hasIngredientData && data.verdict === "UNKNOWN"
                    ? "INGREDIENT ANALYSIS · PUBMED"
                    : "LIVE ANALYSIS · PUBMED"}
            </p>

            <div
              className="font-label rounded-full border px-4 py-2 text-xs"
              style={{
                color,
                borderColor: `color-mix(in oklab, ${color} 45%, transparent)`,
                backgroundColor: `color-mix(in oklab, ${color} 10%, transparent)`,
              }}
            >
              •{" "}
              {isPharma
                ? "MEDICATION"
                : isUnknown
                  ? "PENDING REVIEW"
                  : hasIngredientData && data.verdict === "UNKNOWN"
                    ? "SEE INGREDIENTS"
                    : data.verdict}
            </div>
          </div>

          <h1 className="font-display max-w-4xl text-4xl leading-[0.95] tracking-[-0.04em] text-[var(--ink)] sm:text-5xl md:text-6xl">
            {data.name}
          </h1>

          <HeroSummary
            researchVerdict={data.oneLiner}
            researchGist={data.researchGist}
            communityVerdict={displayCommunityVerdict}
            communityGist={displayCommunityGist}
            safetyNote={data.safetyNote}
          />
        </section>

        {/* ── EVIDENCE BULLETS ──
            For branded products, the first bullet here is the folded
            ingredient summary (see buildIngredientSummaryBullet on the
            backend) — top 5 ingredients + overall read, same click-to-expand
            pattern as every other bullet. No separate section needed. */}
        {data.bullets.length > 0 && (
          <section className="mt-8">
            <SectionHeader
              left="WHAT THE RESEARCH SAYS"
              right="ALL ON PUBMED ↗"
              href={data.pubmedSearchUrl}
            />

            {/* Study-count banner — answers "how much research is this
                actually based on" before reading a single card. */}
            <div
              className="mt-3 inline-flex items-center gap-2 rounded-full px-3.5 py-1.5"
              style={{ backgroundColor: "color-mix(in oklab, var(--sage) 10%, transparent)" }}
            >
              <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ backgroundColor: "var(--sage)" }} />
              <span className="font-label text-[10px]" style={{ color: "var(--sage)" }}>
                BASED ON {data.studies} PUBMED {data.studies === 1 ? "STUDY" : "STUDIES"}
              </span>
            </div>

            {hasIngredientData && (
              <p className="mt-2 font-mono text-xs" style={{ color: "var(--muted-ink)" }}>
                Cards marked "FROM INGREDIENT LIST" below are separate PubMed searches on {data.name}'s
                individual key ingredients, not the product itself — PubMed rarely indexes research on a
                specific commercial product by name.
              </p>
            )}

            <div className="mt-4 space-y-3">
              {data.bullets.map((b, i) => {
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
                      {/* Study type + limitations — visible up front, not
                          hidden behind the click, since knowing "this is an
                          animal study" changes how much weight to give the
                          headline before you even read it. */}
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

                      <p className="text-lg leading-8 text-[var(--ink)]">
                        {b.text}
                      </p>

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
          </section>
        )}

        {/* ── COMMUNITY SENTIMENT + QUOTES ── */}
        {!isPharma && !isUnknown && (
          <section className="mt-8">
            <SectionHeader
              left="WHAT PEOPLE SAY"
              right="READ THREADS ON REDDIT ↗"
              href={data.redditSearchUrl}
            />

            <article className="mt-4 rounded-[22px] border border-white/75 bg-white/90 p-8 shadow-[0_12px_35px_rgba(27,52,72,0.04)]">
              <div className="mb-5 flex items-center justify-between gap-4">
                <p className="font-label text-xs text-[var(--muted-ink)]">
                  COMMUNITY SENTIMENT
                </p>
                {/* Only claim a % when real quotes back it — a bar with no
                    discussion behind it was pure invention (defaulted 50). */}
                {displayQuotes.length > 0 ? (
                  <p className="font-mono text-sm" style={{ color }}>
                    {displaySentiment}% positive
                  </p>
                ) : (
                  <p className="font-mono text-sm text-[var(--muted-ink)]">
                    gathering data…
                  </p>
                )}
              </div>

              {displayQuotes.length > 0 && (
                <div className="h-2 overflow-hidden rounded-full bg-[var(--parchment-deep)]">
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${displaySentiment}%`, backgroundColor: color }}
                  />
                </div>
              )}

              <div className="mt-8 space-y-8">
                {displayQuotes.length > 0 ? (
                  displayQuotes.map((quote) => (
                    <div key={`${quote.handle}-${quote.text}`}>
                      <p className="text-lg italic leading-8 text-[var(--ink)]">
                        "{quote.text}"
                      </p>

                      <a
                        href={quote.url}
                        target="_blank"
                        rel="noreferrer"
                        className="font-mono mt-3 inline-block text-xs text-[var(--terracotta)]"
                      >
                        {quote.handle.toUpperCase()} ↗
                      </a>
                    </div>
                  ))
                ) : (
                  /* No real scraped quotes came back in time — show an honest
                     synthesized snapshot rather than dropping the card or
                     inventing a fake user. Not styled as a quotation (no
                     italics/quote marks) and not attributed to a person; the
                     link points to a real Reddit search so people can read
                     actual threads themselves. */
                  <div>
                    <p className="text-lg leading-8 text-[var(--ink)]">
                      {displayCommunityVerdict ||
                        "Community reactions are still being gathered for this one."}
                    </p>

                    <a
                      href={data.redditSearchUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="font-mono mt-3 inline-block text-xs text-[var(--terracotta)]"
                    >
                      COMMUNITY SNAPSHOT · SEARCH REDDIT ↗
                    </a>
                  </div>
                )}
              </div>
            </article>
          </section>
        )}

        <Comments slug={data.slug} />

        {/* ── RELATED STATIC TRENDS ── */}
        {related.length > 0 && (
          <section className="mt-14">
            <p className="font-label mb-4 text-xs text-[var(--sage)]">
              MAYBE YOU MEANT
            </p>

            <div className="grid gap-4 md:grid-cols-3">
              {related.map((r) => (
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
 * Two headed sections — RESEARCH and COMMUNITY — each a short bulleted list
 * of skimmable gist fragments (2-3 words each) when available, falling back
 * to the single full-sentence summary as one bullet when there's no gist
 * data yet (older cached results, or UNKNOWN/PHARMA with nothing to
 * summarize).
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
    <div className="mt-4 max-w-3xl space-y-4">
      {researchItems.length > 0 && (
        <div>
          <p className="font-label text-[10px] text-[var(--sage)]">RESEARCH</p>
          <SearchGistList items={researchItems} color="var(--sage)" />
        </div>
      )}
      {communityItems.length > 0 && (
        <div>
          <p className="font-label text-[10px] text-[var(--terracotta)]">COMMUNITY</p>
          <SearchGistList items={communityItems} color="var(--terracotta)" />
        </div>
      )}
      {safetyNote && (
        <div className="inline-flex w-fit max-w-[92vw] lg:max-w-none gap-2 rounded-[14px] px-4 py-3" style={{ backgroundColor: "color-mix(in oklab, var(--verdict-mixed) 10%, transparent)" }}>
          <span className="shrink-0" style={{ color: "var(--verdict-mixed)", fontSize: 15, lineHeight: "24px" }}>⚠</span>
          <p className="text-sm leading-6 whitespace-normal lg:whitespace-nowrap" style={{ color: "var(--ink)" }}>
            <span className="font-label mr-1.5 text-[10px]" style={{ color: "var(--verdict-mixed)" }}>SAFETY</span>
            {safetyNote}
          </p>
        </div>
      )}
    </div>
  );
}

/** Same idea as trend.$slug.tsx's GistList — short skimmable fragments as
 *  a bulleted list, or a single full-sentence bullet as a fallback. Named
 *  distinctly (not shared) since these are two independent route files. */
function SearchGistList({ items, color }: { items: string[]; color: string }) {
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
  right?: string;
  href?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <p className="font-label text-xs text-[var(--sage)]">{left}</p>

      {right && href && (
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          className="font-label text-xs text-[var(--terracotta)] transition hover:opacity-70"
        >
          {right}
        </a>
      )}
    </div>
  );
}
import { createFileRoute, Link } from "@tanstack/react-router";
import { TRENDS } from "@/lib/trends";
import { TrendCard } from "@/components/TrendCard";
import { Comments } from "@/components/Comments";
import { toTitleCase } from "@/lib/utils";
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
  const isUnknown = !isPharma && (data.verdict === "UNKNOWN" || data.studies === 0);

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
              {isPharma ? "OUTSIDE OUR SCOPE" : isUnknown ? "NOT YET INDEXED" : "LIVE ANALYSIS · PUBMED"}
            </p>

            <div
              className="font-label rounded-full border px-4 py-2 text-xs"
              style={{
                color,
                borderColor: `color-mix(in oklab, ${color} 45%, transparent)`,
                backgroundColor: `color-mix(in oklab, ${color} 10%, transparent)`,
              }}
            >
              • {isPharma ? "MEDICATION" : isUnknown ? "PENDING REVIEW" : data.verdict}
            </div>
          </div>

          <h1 className="font-display max-w-4xl text-4xl leading-[0.95] tracking-[-0.04em] text-[var(--ink)] sm:text-5xl md:text-6xl">
            {data.name}
          </h1>

          <HeroSummary
            researchVerdict={data.oneLiner}
            communityVerdict={data.communityVerdict}
            safetyNote={data.safetyNote}
          />
        </section>

        {/* ── EVIDENCE BULLETS ── */}
        {data.bullets.length > 0 && (
          <section className="mt-8">
            <SectionHeader
              left="WHAT THE RESEARCH SAYS"
              right="ALL ON PUBMED ↗"
              href={data.pubmedSearchUrl}
            />

            <div className="mt-4 space-y-3">
              {data.bullets.map((b, i) => (
                <article
                  key={i}
                  className="grid gap-4 rounded-[22px] border border-white/75 bg-white/90 p-7 shadow-[0_12px_35px_rgba(27,52,72,0.04)] sm:grid-cols-[48px_1fr] sm:p-8"
                >
                  <div className="font-mono text-sm text-[var(--sage)]">
                    {String(i + 1).padStart(2, "0")}
                  </div>

                  <div>
                    <p className="text-lg leading-8 text-[var(--ink)]">
                      {b.text}
                    </p>

                    <a
                      href={b.url}
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
        )}

        {/* ── COMMUNITY SENTIMENT + QUOTES ── */}
        {data.quotes && data.quotes.length > 0 && (
          <section className="mt-8">
            <SectionHeader
              left="WHAT PEOPLE SAY"
              right="READ THREADS ON REDDIT ↗"
              href={data.redditSearchUrl}
            />

            <article className="mt-4 rounded-[22px] border border-white/75 bg-white/90 p-8 shadow-[0_12px_35px_rgba(27,52,72,0.04)]">
              {/* FIX 4: sentiment bar now matches trend.$slug.tsx */}
              <div className="mb-5 flex items-center justify-between gap-4">
                <p className="font-label text-xs text-[var(--muted-ink)]">
                  COMMUNITY SENTIMENT
                </p>
                <p className="font-mono text-sm" style={{ color }}>
                  {data.sentiment}% positive
                </p>
              </div>

              <div className="h-2 overflow-hidden rounded-full bg-[var(--parchment-deep)]">
                <div
                  className="h-full rounded-full"
                  style={{ width: `${data.sentiment}%`, backgroundColor: color }}
                />
              </div>

              <div className="mt-8 space-y-8">
                {data.quotes.map((quote) => (
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
                ))}
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
 * Two-line hero summary: one line on what the research found, one on
 * community sentiment — instead of a single generic sentence. Falls back
 * to a single line when there's no separate community verdict (e.g.
 * UNKNOWN/PHARMA results with nothing to summarize yet).
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
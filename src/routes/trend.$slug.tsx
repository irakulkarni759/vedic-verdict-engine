import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { trendBySlug, type Trend, type Verdict } from "@/lib/trends";
import { getGeneratedTrendBySlug } from "@/lib/generatedTrends.functions";
import { TrendCard } from "@/components/TrendCard";
import { Comments } from "@/components/Comments";

export const Route = createFileRoute("/trend/$slug")({
  loader: async ({ params }) => {
    const trend = trendBySlug(params.slug) ?? (await getGeneratedTrendBySlug({ data: { slug: params.slug } }));
    if (!trend) throw notFound();

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

function redditHandleUrl(handle: string) {
  const clean = handle.replace(/^@/, "");
  return `https://www.reddit.com/search/?q=${encodeURIComponent(clean)}`;
}

function TrendPage() {
  const { trend, related } = Route.useLoaderData();

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
            researchBullet={trend.evidence[0]}
            quoteBullet={trend.quotes[0]?.text}
            sentiment={trend.sentiment}
            fallback={trend.oneLiner}
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
                    href={pubmedUrl(`${trend.name} ${e}`)}
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
                {trend.sentiment}% positive
              </p>
            </div>

            <div className="h-2 overflow-hidden rounded-full bg-[var(--parchment-deep)]">
              <div
                className="h-full rounded-full bg-[var(--verdict-mixed)]"
                style={{ width: `${trend.sentiment}%` }}
              />
            </div>

            <div className="mt-8 space-y-8">
              {trend.quotes.map((q: { handle: string; text: string }) => (
                <div key={`${q.handle}-${q.text}`}>
                  <p className="text-lg italic leading-8 text-[var(--ink)]">
                    “{q.text}”
                  </p>

                  <a
                    href={redditHandleUrl(q.handle)}
                    target="_blank"
                    rel="noreferrer"
                    className="font-mono mt-3 inline-block text-xs text-[var(--terracotta)]"
                  >
                    {q.handle.toUpperCase()} ↗
                  </a>
                </div>
              ))}
            </div>
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

function sentimentTone(sentiment: number): string {
  if (sentiment >= 70) return "largely positive";
  if (sentiment >= 45) return "mixed";
  return "largely negative";
}

/**
 * Two-line hero summary: one bullet on what the research found, one on
 * community sentiment — instead of a single generic sentence. Falls back
 * to the plain oneLiner when there's no research bullet to lead with (e.g.
 * unmapped/pharma results with nothing to summarize yet).
 */
function HeroSummary({
  researchBullet,
  quoteBullet,
  sentiment,
  fallback,
}: {
  researchBullet: string | undefined;
  quoteBullet: string | undefined;
  sentiment: number;
  fallback: string;
}) {
  if (!researchBullet) {
    return (
      <p className="mt-4 max-w-3xl text-base leading-7 text-[var(--ink)] sm:text-lg">
        {fallback}
      </p>
    );
  }

  const communityBullet = quoteBullet
    ? `Sentiment is ${sentimentTone(sentiment)} (${sentiment}% positive) — "${quoteBullet}"`
    : `Sentiment is ${sentimentTone(sentiment)}, at ${sentiment}% positive.`;

  return (
    <ul className="mt-4 max-w-3xl space-y-2.5 text-base leading-7 text-[var(--ink)] sm:text-lg">
      <li className="flex gap-2.5">
        <span className="mt-2.5 shrink-0 rounded-full" style={{ width: 5, height: 5, backgroundColor: "var(--terracotta)" }} />
        <span>
          <span className="font-label mr-1.5 text-[10px] align-middle text-[var(--sage)]">RESEARCH</span>
          {researchBullet}
        </span>
      </li>
      <li className="flex gap-2.5">
        <span className="mt-2.5 shrink-0 rounded-full" style={{ width: 5, height: 5, backgroundColor: "var(--terracotta)" }} />
        <span>
          <span className="font-label mr-1.5 text-[10px] align-middle text-[var(--sage)]">COMMUNITY</span>
          {communityBullet}
        </span>
      </li>
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

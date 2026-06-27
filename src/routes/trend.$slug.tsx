import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { trendBySlug, type Verdict } from "@/lib/trends";
import { TrendCard } from "@/components/TrendCard";

export const Route = createFileRoute("/trend/$slug")({
  loader: ({ params }) => {
    const trend = trendBySlug(params.slug);
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
    <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: "var(--parchment)" }}>
      <div className="text-center">
        <p className="font-label text-xs" style={{ color: "var(--muted-ink)" }}>NOT FOUND</p>
        <Link to="/" className="font-display text-2xl mt-2 inline-block" style={{ color: "var(--ink)" }}>
          ← back to veda
        </Link>
      </div>
    </div>
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

function VerdictPill({ v }: { v: Verdict }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-label"
      style={{
        fontSize: 10,
        color: verdictColor(v),
        backgroundColor: "color-mix(in oklab, " + verdictColor(v) + " 12%, transparent)",
        border: "1px solid color-mix(in oklab, " + verdictColor(v) + " 35%, transparent)",
      }}
    >
      <span
        className="inline-block rounded-full"
        style={{ width: 5, height: 5, backgroundColor: verdictColor(v) }}
      />
      {v}
    </span>
  );
}

function TrendPage() {
  const { trend, related } = Route.useLoaderData();

  return (
    <div className="min-h-screen pb-24" style={{ backgroundColor: "var(--parchment)" }}>
      <div className="mx-auto max-w-[900px] px-6 pt-8">
        <Link
          to="/category/$slug"
          params={{ slug: trend.category }}
          className="font-label text-[10px] hover:opacity-70"
          style={{ color: "var(--muted-ink)" }}
        >
          ← {trend.category.replace("-", " ").toUpperCase()}
        </Link>

        {/* Hero card */}
        <article
          className="relative mt-6 overflow-hidden rounded-3xl p-8 md:p-10"
          style={{
            backgroundColor: "#fff",
            border: "1px solid color-mix(in oklab, var(--ink) 10%, transparent)",
            boxShadow: "0 1px 0 color-mix(in oklab, var(--ink) 4%, transparent)",
          }}
        >
          {/* Soft verdict glow */}
          <div
            className="pointer-events-none absolute -right-20 -top-20 h-64 w-64 rounded-full"
            style={{
              background: `radial-gradient(circle, color-mix(in oklab, ${verdictColor(trend.verdict)} 22%, transparent) 0%, transparent 70%)`,
            }}
          />
          <div className="relative flex items-start justify-between gap-4">
            <div>
              <p className="font-label text-[10px]" style={{ color: "var(--muted-ink)" }}>
                {trend.category.replace("-", " ").toUpperCase()}
              </p>
              <h1
                className="font-display mt-3"
                style={{ color: "var(--ink)", fontSize: "clamp(36px, 5vw, 56px)", lineHeight: 1 }}
              >
                {trend.name}
              </h1>
            </div>
            <VerdictPill v={trend.verdict} />
          </div>

          <p
            className="relative mt-5 max-w-2xl"
            style={{ color: "var(--ink)", fontSize: 15, lineHeight: 1.6, fontWeight: 300 }}
          >
            {trend.oneLiner}
          </p>

          <div className="relative mt-8 grid grid-cols-2 md:grid-cols-4 gap-6">
            <Stat label="STUDIES" value={trend.studies.toString()} />
            <Stat label="CONFIDENCE" value={trend.confidence} />
            <Stat label="SENTIMENT" value={`${trend.sentiment}%`} />
            <Stat label="UPDATED" value={trend.updated} />
          </div>
        </article>

        {/* Evidence */}
        <section className="mt-10">
          <p className="font-label text-[10px]" style={{ color: "var(--sage)" }}>
            WHAT THE RESEARCH SAYS
          </p>
          <ul className="mt-3 space-y-2">
            {trend.evidence.map((e, i) => (
              <li
                key={i}
                className="flex items-start gap-4 rounded-2xl px-5 py-4"
                style={{
                  backgroundColor: "#fff",
                  border: "1px solid color-mix(in oklab, var(--ink) 8%, transparent)",
                }}
              >
                <span className="font-mono text-[10px] mt-0.5" style={{ color: "var(--sage)" }}>
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span style={{ color: "var(--ink)", fontSize: 14, lineHeight: 1.55, fontWeight: 300 }}>
                  {e}
                </span>
              </li>
            ))}
          </ul>
        </section>

        {/* Community */}
        <section className="mt-10">
          <p className="font-label text-[10px]" style={{ color: "var(--sage)" }}>
            WHAT PEOPLE SAY
          </p>
          <div
            className="mt-3 rounded-2xl p-6"
            style={{
              backgroundColor: "#fff",
              border: "1px solid color-mix(in oklab, var(--ink) 8%, transparent)",
            }}
          >
            <div className="flex items-center justify-between">
              <span className="font-label text-[10px]" style={{ color: "var(--muted-ink)" }}>
                COMMUNITY SENTIMENT
              </span>
              <span className="font-mono text-[11px]" style={{ color: verdictColor(trend.verdict) }}>
                {trend.sentiment}% positive
              </span>
            </div>
            <div
              className="mt-3 h-[6px] w-full rounded-full overflow-hidden"
              style={{ backgroundColor: "color-mix(in oklab, var(--ink) 8%, transparent)" }}
            >
              <div
                className="h-full rounded-full"
                style={{
                  width: `${trend.sentiment}%`,
                  backgroundColor: verdictColor(trend.verdict),
                }}
              />
            </div>
            <div className="mt-6 space-y-5">
              {trend.quotes.map((q, i) => (
                <div key={i}>
                  <p className="italic" style={{ color: "var(--ink)", fontSize: 14, lineHeight: 1.5 }}>
                    "{q.text}"
                  </p>
                  <p className="font-mono mt-1 text-[10px]" style={{ color: "var(--muted-ink)" }}>
                    {q.handle.toUpperCase()}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Related */}
        {related.length > 0 && (
          <section className="mt-10">
            <p className="font-label text-[10px]" style={{ color: "var(--sage)" }}>
              RELATED TRENDS
            </p>
            <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-4">
              {related.map((r) => (
                <TrendCard key={r.slug} trend={r} compact />
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="font-label text-[10px]" style={{ color: "var(--muted-ink)" }}>
        {label}
      </p>
      <p className="font-mono mt-1.5" style={{ color: "var(--ink)", fontSize: 15 }}>
        {value}
      </p>
    </div>
  );
}

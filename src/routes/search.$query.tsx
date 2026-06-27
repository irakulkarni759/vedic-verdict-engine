import { createFileRoute, Link } from "@tanstack/react-router";
import { TRENDS, type Verdict } from "@/lib/trends";
import { TrendCard } from "@/components/TrendCard";

export const Route = createFileRoute("/search/$query")({
  head: ({ params }) => ({
    meta: [
      { title: `${decodeURIComponent(params.query)} — Veda` },
      {
        name: "description",
        content: `Fresh evidence card for "${decodeURIComponent(params.query)}" — PubMed research and Reddit community threads.`,
      },
    ],
  }),
  component: SearchPage,
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

function SearchPage() {
  const { query } = Route.useParams();
  const q = decodeURIComponent(query);
  const verdict: Verdict = "MIXED";
  const color = verdictColor(verdict);

  // pick a few related real trends by naive token overlap
  const tokens = q.toLowerCase().split(/\s+/).filter((t) => t.length > 2);
  const related = TRENDS.filter((t) =>
    tokens.some((tok) => t.name.toLowerCase().includes(tok) || t.slug.includes(tok)),
  ).slice(0, 3);

  return (
    <div className="min-h-screen pb-24" style={{ backgroundColor: "var(--parchment)" }}>
      <div className="mx-auto max-w-[900px] px-6 pt-8">
        <Link
          to="/"
          className="font-label text-[10px] hover:opacity-70"
          style={{ color: "var(--muted-ink)" }}
        >
          ← BACK TO VEDA
        </Link>

        <article
          className="relative mt-6 overflow-hidden rounded-3xl p-8 md:p-10"
          style={{
            backgroundColor: "#fff",
            border: "1px solid color-mix(in oklab, var(--ink) 10%, transparent)",
          }}
        >
          <div
            className="pointer-events-none absolute -right-20 -top-20 h-64 w-64 rounded-full"
            style={{
              background: `radial-gradient(circle, color-mix(in oklab, ${color} 22%, transparent) 0%, transparent 70%)`,
            }}
          />
          <div className="relative flex items-start justify-between gap-4">
            <div>
              <p className="font-label text-[10px]" style={{ color: "var(--muted-ink)" }}>
                FRESH SEARCH · NOT YET INDEXED
              </p>
              <h1
                className="font-display mt-3"
                style={{ color: "var(--ink)", fontSize: "clamp(32px, 5vw, 52px)", lineHeight: 1 }}
              >
                {q}
              </h1>
            </div>
            <span
              className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-label"
              style={{
                fontSize: 10,
                color,
                backgroundColor: "color-mix(in oklab, " + color + " 12%, transparent)",
                border: "1px solid color-mix(in oklab, " + color + " 35%, transparent)",
              }}
            >
              <span className="inline-block rounded-full" style={{ width: 5, height: 5, backgroundColor: color }} />
              PENDING REVIEW
            </span>
          </div>

          <p
            className="relative mt-5 max-w-2xl"
            style={{ color: "var(--ink)", fontSize: 15, lineHeight: 1.6, fontWeight: 300 }}
          >
            We haven't published a verdict for this yet. In the meantime, here's the raw
            evidence — straight from the research papers and the community threads. Read both,
            then decide for yourself.
          </p>

          <div className="relative mt-6 flex flex-wrap gap-2">
            <a
              href={pubmedUrl(q)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 font-label transition-opacity hover:opacity-80"
              style={{
                backgroundColor: "var(--ink)",
                color: "var(--parchment)",
                fontSize: 10,
                letterSpacing: "0.14em",
              }}
            >
              PUBMED RESEARCH ↗
            </a>
            <a
              href={redditUrl(q)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 font-label transition-opacity hover:opacity-80"
              style={{
                backgroundColor: "var(--terracotta)",
                color: "var(--parchment)",
                fontSize: 10,
                letterSpacing: "0.14em",
              }}
            >
              REDDIT THREADS ↗
            </a>
          </div>
        </article>

        <div className="mt-8 grid grid-cols-1 md:grid-cols-2 gap-4">
          <SourceCard
            kind="pubmed"
            title="What the research says"
            blurb={`Open the live PubMed index for "${q}". Filter by review, RCT, or meta-analysis on the left.`}
            href={pubmedUrl(q)}
          />
          <SourceCard
            kind="reddit"
            title="What people are saying"
            blurb={`Open the live Reddit search for "${q}". Sort by Top to find the threads people actually trust.`}
            href={redditUrl(q)}
          />
        </div>

        {related.length > 0 && (
          <section className="mt-10">
            <p className="font-label text-[10px]" style={{ color: "var(--sage)" }}>
              MAYBE YOU MEANT
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

function SourceCard({
  kind,
  title,
  blurb,
  href,
}: {
  kind: "pubmed" | "reddit";
  title: string;
  blurb: string;
  href: string;
}) {
  const accent = kind === "pubmed" ? "var(--ink)" : "var(--terracotta)";
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="block rounded-2xl p-6 transition-transform hover:-translate-y-0.5"
      style={{
        backgroundColor: "#fff",
        border: "1px solid color-mix(in oklab, var(--ink) 8%, transparent)",
      }}
    >
      <p className="font-label text-[10px]" style={{ color: accent }}>
        {kind === "pubmed" ? "PUBMED ↗" : "REDDIT ↗"}
      </p>
      <h3 className="font-display mt-2" style={{ color: "var(--ink)", fontSize: 22, lineHeight: 1.1 }}>
        {title}
      </h3>
      <p
        className="mt-2"
        style={{ color: "var(--muted-ink)", fontSize: 13, lineHeight: 1.5, fontWeight: 300 }}
      >
        {blurb}
      </p>
    </a>
  );
}

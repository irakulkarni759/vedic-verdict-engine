import { createFileRoute, Link } from "@tanstack/react-router";
import { TRENDS } from "@/lib/trends";
import { TrendCard } from "@/components/TrendCard";
import { generateEvidenceVerdict, type EvidenceVerdict } from "@/lib/evidence.functions";

export const Route = createFileRoute("/search/$query")({
  component: SearchPage,
  loader: ({ params }) =>
    generateEvidenceVerdict({ data: { query: decodeURIComponent(params.query) } }),
  pendingComponent: PendingPage,
  errorComponent: ({ error }) => (
    <div className="min-h-screen p-10" style={{ backgroundColor: "var(--parchment)" }}>
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
    <div className="min-h-screen pb-24" style={{ backgroundColor: "var(--parchment)" }}>
      <div className="mx-auto max-w-[900px] px-6 pt-8">
        <Link to="/" className="font-label text-[10px] hover:opacity-70" style={{ color: "var(--muted-ink)" }}>
          ← BACK TO VEDA
        </Link>
        <div className="mt-6 rounded-3xl p-10" style={{ backgroundColor: "#fff", border: "1px solid color-mix(in oklab, var(--ink) 10%, transparent)" }}>
          <p className="font-label text-[10px]" style={{ color: "var(--muted-ink)" }}>
            GATHERING EVIDENCE
          </p>
          <h1 className="font-display mt-3" style={{ color: "var(--ink)", fontSize: "clamp(28px, 4vw, 44px)", lineHeight: 1.05 }}>
            {q}
          </h1>
          <p className="mt-4 font-mono text-xs" style={{ color: "var(--muted-ink)" }}>
            Searching PubMed for clinical evidence…
          </p>
          <div className="mt-6 h-2 w-full overflow-hidden rounded-full" style={{ backgroundColor: "color-mix(in oklab, var(--ink) 8%, transparent)" }}>
            <div className="h-full w-1/3 animate-pulse" style={{ backgroundColor: "var(--terracotta)" }} />
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

  const tokens = q.toLowerCase().split(/\s+/).filter((t) => t.length > 2);
  const related = TRENDS.filter((t) =>
    tokens.some((tok) => t.name.toLowerCase().includes(tok) || t.slug.includes(tok)),
  ).slice(0, 3);

  const isUnknown = data.verdict === "UNKNOWN" || data.studies === 0;

  return (
    <div className="min-h-screen pb-24" style={{ backgroundColor: "var(--parchment)" }}>
      <div className="mx-auto max-w-[900px] px-6 pt-8">
        <Link to="/" className="font-label text-[10px] hover:opacity-70" style={{ color: "var(--muted-ink)" }}>
          ← BACK TO VEDA
        </Link>
        <article
          className="relative mt-6 overflow-hidden rounded-3xl p-8 md:p-10"
          style={{
            backgroundColor: "#fff",
            border: "1px solid color-mix(in oklab, var(--ink) 10%, transparent)",
          }}
        >
          <div className="relative flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="font-label text-[10px]" style={{ color: "var(--muted-ink)" }}>
                {isUnknown ? "FRESH SEARCH · NOT YET INDEXED" : "FRESH SEARCH · GENERATED FROM PUBMED"}
              </p>
              <h1
                className="font-display mt-3"
                style={{ color: "var(--ink)", fontSize: "clamp(32px, 5vw, 52px)", lineHeight: 1 }}
              >
                {q}
              </h1>
            </div>
            <span
              className="inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 font-label"
              style={{
                fontSize: 10,
                color,
                backgroundColor: `color-mix(in oklab, ${color} 12%, transparent)`,
                border: `1px solid color-mix(in oklab, ${color} 35%, transparent)`,
              }}
            >
              <span className="inline-block rounded-full" style={{ width: 5, height: 5, backgroundColor: color }} />
              {isUnknown ? "PENDING REVIEW" : data.verdict}
            </span>
          </div>

          <p
            className="relative mt-5 max-w-2xl"
            style={{ color: "var(--ink)", fontSize: 15, lineHeight: 1.6, fontWeight: 300 }}
          >
            {data.oneLiner}
          </p>

          {!isUnknown && (
            <div className="mt-5 flex flex-wrap gap-x-6 gap-y-2 font-mono text-[11px] uppercase tracking-[0.18em]" style={{ color: "var(--muted-ink)" }}>
              <span>{data.studies} studies</span>
              <span>Confidence: {data.confidence}</span>
            </div>
          )}

          <div className="relative mt-6 flex flex-wrap gap-2">
            <a
              href={data.pubmedSearchUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 font-label transition-opacity hover:opacity-80"
              style={{ backgroundColor: "var(--ink)", color: "var(--parchment)", fontSize: 10, letterSpacing: "0.14em" }}
            >
              ALL PUBMED RESULTS ↗
            </a>
            <a
              href={data.redditSearchUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 font-label transition-opacity hover:opacity-80"
              style={{ backgroundColor: "var(--terracotta)", color: "var(--parchment)", fontSize: 10, letterSpacing: "0.14em" }}
            >
              REDDIT THREADS ↗
            </a>
          </div>
        </article>

        {data.bullets.length > 0 && (
          <section className="mt-10">
            <p className="font-label text-[10px]" style={{ color: "var(--sage)" }}>
              RESEARCH EVIDENCE
            </p>
            <ul className="mt-3 space-y-3">
              {data.bullets.map((b, i) => (
                <li
                  key={i}
                  className="rounded-2xl p-5"
                  style={{
                    backgroundColor: "#fff",
                    border: "1px solid color-mix(in oklab, var(--ink) 8%, transparent)",
                    color: "var(--ink)",
                    fontSize: 14,
                    lineHeight: 1.55,
                  }}
                >
                  {b}
                </li>
              ))}
            </ul>
          </section>
        )}

        {data.articles.length > 0 && (
          <section className="mt-10">
            <p className="font-label text-[10px]" style={{ color: "var(--sage)" }}>
              SOURCE ARTICLES · PUBMED
            </p>
            <ul className="mt-3 divide-y" style={{ borderColor: "color-mix(in oklab, var(--ink) 10%, transparent)" }}>
              {data.articles.map((a) => (
                <li key={a.pmid} className="py-3">
                  <a
                    href={a.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group block"
                  >
                    <p className="font-display group-hover:underline" style={{ color: "var(--ink)", fontSize: 17, lineHeight: 1.25 }}>
                      {a.title}
                    </p>
                    <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.14em]" style={{ color: "var(--muted-ink)" }}>
                      {[a.journal, a.year, `PMID ${a.pmid}`].filter(Boolean).join(" · ")}
                    </p>
                  </a>
                </li>
              ))}
            </ul>
          </section>
        )}

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

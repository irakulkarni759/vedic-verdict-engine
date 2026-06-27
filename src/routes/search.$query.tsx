import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { TRENDS, type Verdict, type Trend } from "@/lib/trends";
import { TrendCard } from "@/components/TrendCard";
import { verifyTrend } from "@/lib/verifyTrend.server";

export const Route = createFileRoute("/search/$query")({
  component: SearchPage,
});

function verdictColor(v: Verdict) {
  return v === "BACKED" ? "var(--verdict-backed)" : v === "MIXED" ? "var(--verdict-mixed)" : "var(--verdict-debunked)";
}

function pubmedUrl(q: string) { return `https://pubmed.ncbi.nlm.nih.gov/?term=${encodeURIComponent(q)}`; }
function redditUrl(q: string) { return `https://www.reddit.com/search/?q=${encodeURIComponent(q)}`; }

function SearchPage() {
  const { query } = Route.useParams();
  const q = decodeURIComponent(query);
  const [trend, setTrend] = useState<Trend | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    verifyTrend({ data: { query: q } })
      .then((result) => { setTrend(result); setLoading(false); })
      .catch((err) => { setError(err?.message ?? "Something went wrong."); setLoading(false); });
  }, [q]);

  const verdict: Verdict = trend?.verdict ?? "MIXED";
  const color = verdictColor(verdict);
  const tokens = q.toLowerCase().split(/\s+/).filter((t) => t.length > 2);
  const related = TRENDS.filter((t) => tokens.some((tok) => t.name.toLowerCase().includes(tok) || t.slug.includes(tok))).slice(0, 3);

  return (
    <div className="min-h-screen pb-24" style={{ backgroundColor: "var(--parchment)" }}>
      <div className="mx-auto max-w-[900px] px-6 pt-8">
        <Link to="/" className="font-label text-[10px] hover:opacity-70" style={{ color: "var(--muted-ink)" }}>← BACK TO VEDA</Link>
        <article className="relative mt-6 overflow-hidden rounded-3xl p-8 md:p-10" style={{ backgroundColor: "#fff", border: "1px solid color-mix(in oklab, var(--ink) 10%, transparent)" }}>
          <div className="pointer-events-none absolute -right-20 -top-20 h-64 w-64 rounded-full" style={{ background: `radial-gradient(circle, color-mix(in oklab, ${color} 22%, transparent) 0%, transparent 70%)` }} />
          <div className="relative flex items-start justify-between gap-4">
            <div>
              <p className="font-label text-[10px]" style={{ color: "var(--muted-ink)" }}>{loading ? "ANALYSING · RUNNING PIPELINE" : trend ? "VEDA VERDICT" : "FRESH SEARCH · NOT YET INDEXED"}</p>
              <h1 className="font-display mt-3" style={{ color: "var(--ink)", fontSize: "clamp(32px, 5vw, 52px)", lineHeight: 1 }}>{q}</h1>
            </div>
            {loading ? (
              <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-label" style={{ fontSize: 10, color: "var(--muted-ink)", backgroundColor: "color-mix(in oklab, var(--muted-ink) 10%, transparent)", border: "1px solid color-mix(in oklab, var(--muted-ink) 25%, transparent)" }}>
                <span className="inline-block rounded-full animate-pulse" style={{ width: 5, height: 5, backgroundColor: "var(--muted-ink)" }} />ANALYSING…
              </span>
            ) : trend ? (
              <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-label" style={{ fontSize: 10, color, backgroundColor: `color-mix(in oklab, ${color} 12%, transparent)`, border: `1px solid color-mix(in oklab, ${color} 35%, transparent)` }}>
                <span className="inline-block rounded-full" style={{ width: 5, height: 5, backgroundColor: color }} />{verdict}
              </span>
            ) : null}
          </div>
          {loading && (
            <div className="relative mt-6 space-y-2">
              <div className="h-3 w-3/4 rounded animate-pulse" style={{ backgroundColor: "color-mix(in oklab, var(--ink) 8%, transparent)" }} />
              <div className="h-3 w-1/2 rounded animate-pulse" style={{ backgroundColor: "color-mix(in oklab, var(--ink) 6%, transparent)" }} />
              <p className="mt-4 text-xs" style={{ color: "var(--muted-ink)" }}>Scanning PubMed, synthesising evidence, and checking community sentiment — this takes about 15–20 seconds.</p>
            </div>
          )}
          {!loading && error && <p className="relative mt-5" style={{ color: "var(--verdict-debunked)", fontSize: 14 }}>Pipeline error: {error}</p>}
          {!loading && trend && (
            <>
              <p className="relative mt-5 max-w-2xl" style={{ color: "var(--ink)", fontSize: 15, lineHeight: 1.6, fontWeight: 300 }}>{trend.summary}</p>
              {trend.evidencePoints?.length > 0 && (
                <ul className="relative mt-4 space-y-1">
                  {trend.evidencePoints.slice(0, 4).map((pt, i) => (
                    <li key={i} className="flex gap-2 text-sm" style={{ color: "var(--ink)", fontWeight: 300 }}><span style={{ color }}>→</span>{pt}</li>
                  ))}
                </ul>
              )}
              <div className="relative mt-4 flex items-center gap-4 text-xs" style={{ color: "var(--muted-ink)" }}>
                <span>{trend.studyCount} studies</span><span>·</span><span>{trend.confidence} confidence</span>
                {trend.sentimentScore !== undefined && <><span>·</span><span>Community score {trend.sentimentScore > 0 ? "+" : ""}{trend.sentimentScore}</span></>}
              </div>
            </>
          )}
          <div className="relative mt-6 flex flex-wrap gap-2">
            <a href={pubmedUrl(q)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 font-label transition-opacity hover:opacity-80" style={{ backgroundColor: "var(--ink)", color: "var(--parchment)", fontSize: 10, letterSpacing: "0.14em" }}>PUBMED RESEARCH ↗</a>
            <a href={redditUrl(q)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 font-label transition-opacity hover:opacity-80" style={{ backgroundColor: "var(--terracotta)", color: "var(--parchment)", fontSize: 10, letterSpacing: "0.14em" }}>REDDIT THREADS ↗</a>
          </div>
        </article>
        {!loading && trend?.opinions && trend.opinions.length > 0 && (
          <section className="mt-6">
            <p className="font-label text-[10px] mb-3" style={{ color: "var(--sage)" }}>COMMUNITY VOICES</p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {trend.opinions.slice(0, 3).map((op, i) => (
                <div key={i} className="rounded-2xl p-4" style={{ backgroundColor: "#fff", border: "1px solid color-mix(in oklab, var(--ink) 8%, transparent)" }}>
                  <p className="font-label text-[10px] mb-2" style={{ color: "var(--terracotta)" }}>{op.handle}</p>
                  <p style={{ color: "var(--ink)", fontSize: 13, lineHeight: 1.5, fontWeight: 300 }}>"{op.text}"</p>
                </div>
              ))}
            </div>
          </section>
        )}
        {related.length > 0 && (
          <section className="mt-10">
            <p className="font-label text-[10px]" style={{ color: "var(--sage)" }}>MAYBE YOU MEANT</p>
            <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-4">
              {related.map((r) => <TrendCard key={r.slug} trend={r} compact />)}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

import { Link } from "@tanstack/react-router";
import type { Trend, Verdict } from "@/lib/trends";

function verdictColor(v: Verdict) {
  return v === "BACKED"
    ? "var(--verdict-backed)"
    : v === "MIXED"
    ? "var(--verdict-mixed)"
    : "var(--verdict-debunked)";
}

export function TrendCard({ trend, compact = false }: { trend: Trend; compact?: boolean }) {
  return (
    <Link
      to="/trend/$slug"
      params={{ slug: trend.slug }}
      aria-label={`See the evidence for ${trend.name} — verdict ${trend.verdict}`}
      className="group block rounded-2xl p-5 transition-all hover:-translate-y-0.5"
      style={{
        backgroundColor: "#fff",
        border: "1px solid color-mix(in oklab, var(--ink) 8%, transparent)",
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="font-label text-[10px]" style={{ color: "var(--muted-ink)" }}>
          {trend.category.replace("-", " ").toUpperCase()}
        </p>
        <span
          className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 font-label"
          style={{
            fontSize: 12,
            color: verdictColor(trend.verdict),
            backgroundColor: "color-mix(in oklab, " + verdictColor(trend.verdict) + " 12%, transparent)",
          }}
        >
          <span
            className="inline-block rounded-full"
            style={{ width: 5, height: 5, backgroundColor: verdictColor(trend.verdict) }}
          />
          {trend.verdict}
        </span>
      </div>
      <h3
        className="font-display mt-2"
        style={{ color: "var(--ink)", fontSize: 22, lineHeight: 1.1 }}
      >
        {trend.name}
      </h3>
      {!compact && (
        <p
          className="mt-2 line-clamp-2"
          style={{ color: "var(--muted-ink)", fontSize: 13, lineHeight: 1.5, fontWeight: 300 }}
        >
          {trend.oneLiner}
        </p>
      )}
      <div className="mt-4 flex items-center justify-between">
        <span className="font-mono text-[10px]" style={{ color: "var(--muted-ink)" }}>
          {trend.studies} STUDIES
        </span>
        <span className="font-mono text-[10px]" style={{ color: "var(--muted-ink)" }}>
          {trend.confidence.toUpperCase()} CONF.
        </span>
      </div>
    </Link>
  );
}

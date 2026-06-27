import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { VerdictBadge } from "@/components/VerdictBadge";
import { VERDICT_META } from "@/lib/verdict";
import { verifyTrend } from "@/lib/verifyTrend.server";
import type { Trend } from "@/data/trends";

// Replaces the old static UnmappedState. Generation is opt-in (a button, not
// auto-triggered on render) — each run costs real API credits and can take
// up to ~a minute, so it shouldn't fire silently on every navigation,
// back/forward, or accidental refresh.

export function UnmappedGenerator({ query }: { query: string }) {
  const callVerifyTrend = useServerFn(verifyTrend);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [result, setResult] = useState<Trend | null>(null);
  const [errorMessage, setErrorMessage] = useState("");

  const onGenerate = async () => {
    setStatus("loading");
    setErrorMessage("");
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const trend = await callVerifyTrend({ data: { query } } as any);
      setResult(trend);
      setStatus("idle");
    } catch (e) {
      setErrorMessage(
        e instanceof Error ? e.message : "Something went wrong generating this verdict.",
      );
      setStatus("error");
    }
  };

  if (result) {
    const meta = VERDICT_META[result.verdict];
    return (
      <div className="mt-10">
        <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
          Freshly generated
        </span>
        <Link
          to="/trend/$id"
          params={{ id: result.id }}
          className={`group glass-card glass-card-hover ${meta.glowClass} mt-4 block overflow-hidden p-6 sm:p-8`}
          style={{ backgroundImage: `linear-gradient(180deg, ${meta.color}14, transparent 50%)` }}
        >
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-4 sm:flex sm:items-center sm:justify-between">
            <div className="min-w-0">
              <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
                {result.category.replace("-", " ")}
              </span>
              <h2 className="font-display mt-1 text-2xl font-normal leading-tight sm:text-4xl">
                {result.name}
              </h2>
            </div>
            <VerdictBadge verdict={result.verdict} size="lg" />
          </div>
          <p className="mt-4 max-w-3xl text-sm leading-relaxed text-muted-foreground sm:text-base">
            {result.summary}
          </p>
          <div className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-2 font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground/80">
            <span>{result.studyCount} studies</span>
            <span>Confidence: {result.confidence}</span>
            <span>Updated {result.lastUpdated}</span>
          </div>
        </Link>
      </div>
    );
  }

  const meta = VERDICT_META.unmapped;
  return (
    <div className="mt-10">
      <div
        className={`glass-card ${meta.glowClass} p-8 sm:p-10`}
        style={{ backgroundImage: `linear-gradient(180deg, ${meta.color}12, transparent 50%)` }}
      >
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-4 sm:flex sm:items-center sm:justify-between">
          <div className="min-w-0">
            <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
              No mapping yet
            </span>
            <h2 className="font-display mt-1 truncate text-2xl font-normal italic leading-tight sm:text-4xl">
              {query}
            </h2>
          </div>
          <VerdictBadge verdict="unmapped" size="lg" />
        </div>
        <p className="mt-4 max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-base">
          Not mapped yet — Veda hasn&rsquo;t gathered the evidence on this one yet. Run the evidence
          engine now to generate a verdict.
        </p>

        <button
          type="button"
          onClick={onGenerate}
          disabled={status === "loading"}
          className="mt-5 inline-flex items-center gap-2 rounded-xl bg-ink px-4 py-2.5 font-mono text-[11px] uppercase tracking-[0.18em] text-paper transition-transform hover:translate-x-0.5 disabled:opacity-60 disabled:hover:translate-x-0"
        >
          {status === "loading" ? "Gathering evidence…" : "Generate evidence verdict"}
        </button>

        {status === "loading" ? (
          <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            Searching PubMed, scanning community discussion, synthesizing — this can take up to a
            minute.
          </p>
        ) : null}

        {status === "error" ? <p className="mt-3 text-sm text-[#c0432b]">{errorMessage}</p> : null}
      </div>
    </div>
  );
}

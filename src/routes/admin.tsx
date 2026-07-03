import { createFileRoute } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { adminCheckPassword, adminDeleteComment, adminListComments, type AdminComment } from "@/lib/comments.functions";
import { adminStandardizeTrendNames, adminBackfillVerdictSummaries, adminRefreshRedditQuotes } from "@/lib/generatedTrends.functions";

export const Route = createFileRoute("/admin")({
  head: () => ({
    meta: [{ name: "robots", content: "noindex, nofollow" }],
  }),
  component: AdminPage,
});

const SESSION_KEY = "veda_admin_password";

function AdminPage() {
  const [password, setPassword] = useState("");
  const [authed, setAuthed] = useState(false);
  const [comments, setComments] = useState<AdminComment[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [standardizing, setStandardizing] = useState(false);
  const [standardizeResult, setStandardizeResult] = useState<string | null>(null);
  const [summarizing, setSummarizing] = useState(false);
  const [summarizeResult, setSummarizeResult] = useState<string | null>(null);
  const [refreshingQuotes, setRefreshingQuotes] = useState(false);
  const [refreshQuotesResult, setRefreshQuotesResult] = useState<string | null>(null);

  async function loadComments(pw: string) {
    setLoading(true);
    const res = await adminListComments({ data: { password: pw } });
    setLoading(false);
    if (!res.ok || !res.comments) {
      setError(res.error ?? "Couldn't load comments.");
      return;
    }
    setComments(res.comments);
  }

  async function login(pw: string) {
    setError(null);
    setLoading(true);
    const check = await adminCheckPassword({ data: { password: pw } });
    setLoading(false);
    if (!check.ok) {
      setError("Wrong password.");
      setAuthed(false);
      window.sessionStorage.removeItem(SESSION_KEY);
      return;
    }
    setAuthed(true);
    window.sessionStorage.setItem(SESSION_KEY, pw);
    // Best-effort: comment loading failing (e.g. table not migrated yet)
    // shouldn't lock the rest of the admin page.
    void loadComments(pw);
  }

  async function submitLogin(e: FormEvent) {
    e.preventDefault();
    await login(password);
  }

  async function remove(id: string) {
    const pw = window.sessionStorage.getItem(SESSION_KEY) ?? password;
    const res = await adminDeleteComment({ data: { password: pw, id } });
    if (!res.ok) {
      setError(res.error ?? "Couldn't delete comment.");
      return;
    }
    setComments((prev) => prev.filter((c) => c.id !== id));
  }

  async function standardizeTitles() {
    const pw = window.sessionStorage.getItem(SESSION_KEY) ?? password;
    setStandardizing(true);
    setStandardizeResult(null);
    const res = await adminStandardizeTrendNames({ data: { password: pw } });
    setStandardizing(false);
    if (!res.ok) {
      setStandardizeResult(res.error ?? "Couldn't standardize titles.");
      return;
    }
    setStandardizeResult(`Updated ${res.updated} of ${res.total} trends (${res.skipped} already fine or skipped).`);
  }

  async function backfillSummaries(force: boolean) {
    const pw = window.sessionStorage.getItem(SESSION_KEY) ?? password;
    setSummarizing(true);
    setSummarizeResult(null);
    const res = await adminBackfillVerdictSummaries({ data: { password: pw, force } });
    setSummarizing(false);
    if (!res.ok) {
      setSummarizeResult(res.error ?? "Couldn't backfill summaries.");
      return;
    }
    setSummarizeResult(`Updated ${res.updated} of ${res.total} trends (${res.skipped} already fine or skipped).`);
  }

  async function refreshQuotes() {
    const pw = window.sessionStorage.getItem(SESSION_KEY) ?? password;
    setRefreshingQuotes(true);
    setRefreshQuotesResult(null);
    const res = await adminRefreshRedditQuotes({ data: { password: pw } });
    setRefreshingQuotes(false);
    if (!res.ok) {
      setRefreshQuotesResult(res.error ?? "Couldn't refresh quotes.");
      return;
    }
    setRefreshQuotesResult(
      `${res.updated} of ${res.total} trends got real quotes; ${res.emptied} had none found and are now empty (not fabricated).`,
    );
  }

  // Try to resume a session on first render.
  useState(() => {
    const saved = window.sessionStorage.getItem(SESSION_KEY);
    if (saved) {
      setPassword(saved);
      login(saved);
    }
  });

  if (!authed) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[var(--parchment)] px-6">
        <form
          onSubmit={submitLogin}
          className="w-full max-w-sm rounded-[22px] border border-white/75 bg-white/90 p-8 shadow-[0_12px_35px_rgba(27,52,72,0.06)]"
        >
          <p className="font-label mb-4 text-xs text-[var(--sage)]">ADMIN</p>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            autoFocus
            className="font-mono w-full rounded-full border border-[var(--muted-ink)]/20 bg-white px-4 py-2 text-sm text-[var(--ink)] outline-none focus:border-[var(--terracotta)]"
          />
          {error && (
            <p className="font-mono mt-3 text-xs text-[var(--verdict-debunked)]">{error}</p>
          )}
          <button
            type="submit"
            disabled={loading}
            className="font-label mt-4 w-full rounded-full bg-[var(--ink)] px-5 py-2.5 text-xs text-white transition hover:translate-y-[-1px] disabled:opacity-40"
          >
            {loading ? "CHECKING…" : "ENTER"}
          </button>
        </form>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[var(--parchment)] px-5 py-8 sm:px-8 sm:py-10">
      <div className="mx-auto max-w-[900px]">
        <div className="mb-6 flex items-center justify-between">
          <p className="font-label text-xs text-[var(--sage)]">
            {comments.length} COMMENT{comments.length === 1 ? "" : "S"}
          </p>
          <button
            onClick={() => loadComments(window.sessionStorage.getItem(SESSION_KEY) ?? password)}
            className="font-label text-xs text-[var(--terracotta)] hover:opacity-70"
          >
            REFRESH
          </button>
        </div>

        {error && <p className="font-mono mb-4 text-xs text-[var(--verdict-debunked)]">{error}</p>}

        <div className="mb-6 rounded-[16px] border border-white/75 bg-white/90 p-5 shadow-[0_8px_24px_rgba(27,52,72,0.04)]">
          <p className="font-label mb-2 text-xs text-[var(--sage)]">TITLE BACKFILL</p>
          <p className="mb-3 text-sm leading-6 text-[var(--ink)]">
            Rewrites every stored trend title into "X for Y" form (e.g. "Rosemary Oil for Hair Growth"),
            inferring a purpose for titles that don't already have one. Safe to re-run — already-standardized
            titles are skipped.
          </p>
          <button
            onClick={standardizeTitles}
            disabled={standardizing}
            className="font-label rounded-full bg-[var(--ink)] px-5 py-2.5 text-xs text-white transition hover:translate-y-[-1px] disabled:opacity-40"
          >
            {standardizing ? "STANDARDIZING…" : "STANDARDIZE TITLES"}
          </button>
          {standardizeResult && (
            <p className="font-mono mt-3 text-xs text-[var(--muted-ink)]">{standardizeResult}</p>
          )}
        </div>

        <div className="mb-6 rounded-[16px] border border-white/75 bg-white/90 p-5 shadow-[0_8px_24px_rgba(27,52,72,0.04)]">
          <p className="font-label mb-2 text-xs text-[var(--sage)]">SUMMARY BACKFILL</p>
          <p className="mb-3 text-sm leading-6 text-[var(--ink)]">
            Rewrites the old templated summary into a real research verdict and fills in a community
            verdict for every stored trend, using each trend's existing evidence and quotes (no new
            PubMed calls). "Backfill" only fills in trends missing a community verdict. "Re-run all"
            regenerates every trend regardless — use that after a prompt-wording change like this one.
          </p>
          <div className="flex flex-wrap gap-3">
            <button
              onClick={() => backfillSummaries(false)}
              disabled={summarizing}
              className="font-label rounded-full bg-[var(--ink)] px-5 py-2.5 text-xs text-white transition hover:translate-y-[-1px] disabled:opacity-40"
            >
              {summarizing ? "WORKING…" : "BACKFILL MISSING"}
            </button>
            <button
              onClick={() => backfillSummaries(true)}
              disabled={summarizing}
              className="font-label rounded-full border border-[var(--terracotta)] px-5 py-2.5 text-xs text-[var(--terracotta)] transition hover:bg-[var(--terracotta)]/10 disabled:opacity-40"
            >
              {summarizing ? "WORKING…" : "RE-RUN ALL"}
            </button>
          </div>
          {summarizeResult && (
            <p className="font-mono mt-3 text-xs text-[var(--muted-ink)]">{summarizeResult}</p>
          )}
        </div>

        <div className="mb-6 rounded-[16px] border-2 border-[var(--terracotta)] bg-white/90 p-5 shadow-[0_8px_24px_rgba(27,52,72,0.04)]">
          <p className="font-label mb-2 text-xs text-[var(--terracotta)]">REAL REDDIT QUOTES (IMPORTANT)</p>
          <p className="mb-3 text-sm leading-6 text-[var(--ink)]">
            Replaces every stored trend's community quotes — which were previously fabricated by Claude
            with made-up handles — with real Reddit comments, re-searched using each trend's original
            query, using Reddit's public search (no API credentials needed, but no guarantees either —
            Reddit can rate-limit this without notice). Trends where no real
            comments turn up get an empty list, never a fabricated fallback.
          </p>
          <button
            onClick={refreshQuotes}
            disabled={refreshingQuotes}
            className="font-label rounded-full bg-[var(--terracotta)] px-5 py-2.5 text-xs text-white transition hover:translate-y-[-1px] disabled:opacity-40"
          >
            {refreshingQuotes ? "FETCHING FROM REDDIT…" : "REPLACE WITH REAL QUOTES"}
          </button>
          {refreshQuotesResult && (
            <p className="font-mono mt-3 text-xs text-[var(--muted-ink)]">{refreshQuotesResult}</p>
          )}
        </div>

        <div className="space-y-3">
          {comments.map((c) => (
            <div
              key={c.id}
              className="rounded-[16px] border border-white/75 bg-white/90 p-5 shadow-[0_8px_24px_rgba(27,52,72,0.04)]"
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="font-label text-xs text-[var(--muted-ink)]">
                    {c.trendSlug} · {c.author} · {new Date(c.createdAt).toLocaleString()}
                  </p>
                  <p className="mt-2 text-sm leading-6 text-[var(--ink)]">{c.body}</p>
                </div>
                <button
                  onClick={() => remove(c.id)}
                  className="font-label shrink-0 rounded-full border border-[var(--verdict-debunked)]/40 px-3 py-1.5 text-[11px] text-[var(--verdict-debunked)] transition hover:bg-[var(--verdict-debunked)]/10"
                >
                  DELETE
                </button>
              </div>
            </div>
          ))}
          {comments.length === 0 && !loading && (
            <p className="font-mono text-xs text-[var(--muted-ink)]">No comments yet.</p>
          )}
        </div>
      </div>
    </main>
  );
}

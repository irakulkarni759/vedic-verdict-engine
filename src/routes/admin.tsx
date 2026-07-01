import { createFileRoute } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { adminDeleteComment, adminListComments, type AdminComment } from "@/lib/comments.functions";

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

  async function load(pw: string) {
    setLoading(true);
    setError(null);
    const res = await adminListComments({ data: { password: pw } });
    setLoading(false);

    if (!res.ok || !res.comments) {
      setError(res.error ?? "Wrong password.");
      setAuthed(false);
      window.sessionStorage.removeItem(SESSION_KEY);
      return;
    }

    setComments(res.comments);
    setAuthed(true);
    window.sessionStorage.setItem(SESSION_KEY, pw);
  }

  async function login(e: FormEvent) {
    e.preventDefault();
    await load(password);
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

  // Try to resume a session on first render.
  useState(() => {
    const saved = window.sessionStorage.getItem(SESSION_KEY);
    if (saved) {
      setPassword(saved);
      load(saved);
    }
  });

  if (!authed) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[var(--parchment)] px-6">
        <form
          onSubmit={login}
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
            onClick={() => load(password)}
            className="font-label text-xs text-[var(--terracotta)] hover:opacity-70"
          >
            REFRESH
          </button>
        </div>

        {error && <p className="font-mono mb-4 text-xs text-[var(--verdict-debunked)]">{error}</p>}

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

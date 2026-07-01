import { useEffect, useState, type FormEvent } from "react";
import { getComments, postComment, type Comment } from "@/lib/comments.functions";

type Props = { slug: string };

const AUTHOR_STORAGE_KEY = "veda_comment_author";

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

export function Comments({ slug }: Props) {
  const [comments, setComments] = useState<Comment[] | null>(null);
  const [author, setAuthor] = useState("");
  const [body, setBody] = useState("");
  const [website, setWebsite] = useState(""); // honeypot — real users never see this
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setComments(null);
    getComments({ data: { slug } }).then((rows) => {
      if (!cancelled) setComments(rows);
    });
    const saved = window.localStorage.getItem(AUTHOR_STORAGE_KEY);
    if (saved) setAuthor(saved);
    return () => {
      cancelled = true;
    };
  }, [slug]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const trimmedBody = body.trim();
    if (trimmedBody.length < 2) {
      setError("Comment is too short.");
      return;
    }

    setSubmitting(true);
    const res = await postComment({ data: { slug, author, body: trimmedBody, website } });
    setSubmitting(false);

    if (!res.ok) {
      setError(res.error ?? "Couldn't post comment. Try again.");
      return;
    }

    if (res.comment) {
      setComments((prev) => [...(prev ?? []), res.comment as Comment]);
    }
    setBody("");
    if (author.trim()) {
      window.localStorage.setItem(AUTHOR_STORAGE_KEY, author.trim());
    }
  }

  return (
    <section className="mt-14">
      <p className="font-label mb-4 text-xs text-[var(--sage)]">
        {comments && comments.length > 0
          ? `${comments.length} COMMENT${comments.length === 1 ? "" : "S"}`
          : "COMMENTS"}
      </p>

      <div className="rounded-[22px] border border-white/75 bg-white/90 p-6 shadow-[0_12px_35px_rgba(27,52,72,0.04)] sm:p-8">
        <form onSubmit={submit} className="relative space-y-3">
          <input
            type="text"
            name="website"
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
            tabIndex={-1}
            autoComplete="off"
            aria-hidden="true"
            className="absolute -left-[9999px] h-0 w-0 opacity-0"
          />

          <input
            value={author}
            onChange={(e) => setAuthor(e.target.value)}
            placeholder="Name (optional)"
            maxLength={40}
            className="font-mono w-full rounded-full border border-[var(--muted-ink)]/20 bg-white px-4 py-2 text-sm text-[var(--ink)] outline-none transition focus:border-[var(--terracotta)]"
          />

          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Share your take..."
            maxLength={1000}
            rows={3}
            required
            className="w-full rounded-[16px] border border-[var(--muted-ink)]/20 bg-white px-4 py-3 text-sm leading-6 text-[var(--ink)] outline-none transition focus:border-[var(--terracotta)]"
          />

          <div className="flex items-center justify-between gap-4">
            {error ? (
              <p className="font-mono text-xs text-[var(--verdict-debunked)]">{error}</p>
            ) : (
              <span />
            )}

            <button
              type="submit"
              disabled={submitting || body.trim().length < 2}
              className="font-label rounded-full bg-[var(--ink)] px-5 py-2.5 text-xs text-white transition hover:translate-y-[-1px] disabled:opacity-40 disabled:hover:translate-y-0"
            >
              {submitting ? "POSTING…" : "POST COMMENT"}
            </button>
          </div>
        </form>

        <div className="mt-8 space-y-6">
          {comments === null ? (
            <p className="font-mono text-xs text-[var(--muted-ink)]">Loading comments…</p>
          ) : comments.length === 0 ? (
            <p className="font-mono text-xs text-[var(--muted-ink)]">Be the first to comment.</p>
          ) : (
            comments.map((c) => (
              <div
                key={c.id}
                className="border-t border-[var(--muted-ink)]/10 pt-6 first:border-t-0 first:pt-0"
              >
                <div className="flex items-baseline justify-between gap-4">
                  <p className="font-label text-xs text-[var(--ink)]">{c.author || "Anonymous"}</p>
                  <p className="font-mono text-[11px] text-[var(--muted-ink)]">{timeAgo(c.createdAt)}</p>
                </div>
                <p className="mt-2 text-sm leading-7 text-[var(--ink)]">{c.body}</p>
              </div>
            ))
          )}
        </div>
      </div>
    </section>
  );
}

import { useEffect, useState, type FormEvent } from "react";
import { getComments, postComment, updateComment, type Comment } from "@/lib/comments.functions";

type Props = { slug: string };

const AUTHOR_STORAGE_KEY = "veda_comment_author";
const TOKENS_STORAGE_KEY = "veda_comment_tokens"; // { [commentId]: editToken }

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

function loadTokens(): Record<string, string> {
  try {
    return JSON.parse(window.localStorage.getItem(TOKENS_STORAGE_KEY) ?? "{}");
  } catch {
    return {};
  }
}

function saveToken(id: string, token: string) {
  const tokens = loadTokens();
  tokens[id] = token;
  window.localStorage.setItem(TOKENS_STORAGE_KEY, JSON.stringify(tokens));
}

export function Comments({ slug }: Props) {
  const [comments, setComments] = useState<Comment[] | null>(null);
  const [author, setAuthor] = useState("");
  const [body, setBody] = useState("");
  const [website, setWebsite] = useState(""); // honeypot — real users never see this
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tokens, setTokens] = useState<Record<string, string>>({});

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setComments(null);
    getComments({ data: { slug } }).then((rows) => {
      if (!cancelled) setComments(rows);
    });
    const savedAuthor = window.localStorage.getItem(AUTHOR_STORAGE_KEY);
    if (savedAuthor) setAuthor(savedAuthor);
    setTokens(loadTokens());
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
      if (res.editToken) {
        saveToken(res.comment.id, res.editToken);
        setTokens((prev) => ({ ...prev, [res.comment!.id]: res.editToken! }));
      }
    }
    setBody("");
    if (author.trim()) {
      window.localStorage.setItem(AUTHOR_STORAGE_KEY, author.trim());
    }
  }

  function startEdit(c: Comment) {
    setEditingId(c.id);
    setEditValue(c.body);
    setEditError(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditValue("");
    setEditError(null);
  }

  async function saveEdit(id: string) {
    const trimmed = editValue.trim();
    if (trimmed.length < 2) {
      setEditError("Comment is too short.");
      return;
    }
    const token = tokens[id];
    if (!token) {
      setEditError("Can't edit this comment.");
      return;
    }

    setEditSaving(true);
    const res = await updateComment({ data: { id, editToken: token, body: trimmed } });
    setEditSaving(false);

    if (!res.ok || !res.comment) {
      setEditError(res.error ?? "Couldn't save your edit.");
      return;
    }

    setComments((prev) => (prev ?? []).map((c) => (c.id === id ? (res.comment as Comment) : c)));
    setEditingId(null);
    setEditValue("");
  }

  return (
    <section className="mt-14">
      <p className="font-label mb-4 text-xs text-[var(--sage)]">
        {comments && comments.length > 0
          ? `${comments.length} COMMENT${comments.length === 1 ? "" : "S"}`
          : "COMMENTS"}
      </p>

      <div className="rounded-[22px] border border-white/75 bg-white/90 p-6 shadow-[0_12px_35px_rgba(27,52,72,0.04)] sm:p-8">
        <p className="mb-4 text-sm leading-6 text-[var(--muted-ink)]">
          Add context that might help others — skin type, conditions like PCOS,
          what you'd tried before. The more specific, the more useful.
        </p>

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
            placeholder="Share your experience..."
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
            comments.map((c) => {
              const canEdit = !!tokens[c.id];
              const isEditing = editingId === c.id;

              return (
                <div
                  key={c.id}
                  className="border-t border-[var(--muted-ink)]/10 pt-6 first:border-t-0 first:pt-0"
                >
                  <div className="flex items-baseline justify-between gap-4">
                    <p className="font-label text-xs text-[var(--ink)]">{c.author || "Anonymous"}</p>
                    <div className="flex items-center gap-3">
                      <p className="font-mono text-[11px] text-[var(--muted-ink)]">
                        {timeAgo(c.createdAt)}
                        {c.editedAt ? " · edited" : ""}
                      </p>
                      {canEdit && !isEditing && (
                        <button
                          onClick={() => startEdit(c)}
                          className="font-label text-[11px] text-[var(--terracotta)] hover:opacity-70"
                        >
                          EDIT
                        </button>
                      )}
                    </div>
                  </div>

                  {isEditing ? (
                    <div className="mt-2 space-y-2">
                      <textarea
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        maxLength={1000}
                        rows={3}
                        className="w-full rounded-[16px] border border-[var(--muted-ink)]/20 bg-white px-4 py-3 text-sm leading-6 text-[var(--ink)] outline-none transition focus:border-[var(--terracotta)]"
                      />
                      <div className="flex items-center justify-between gap-4">
                        {editError ? (
                          <p className="font-mono text-xs text-[var(--verdict-debunked)]">{editError}</p>
                        ) : (
                          <span />
                        )}
                        <div className="flex items-center gap-3">
                          <button
                            onClick={cancelEdit}
                            className="font-label text-xs text-[var(--muted-ink)] hover:opacity-70"
                          >
                            CANCEL
                          </button>
                          <button
                            onClick={() => saveEdit(c.id)}
                            disabled={editSaving || editValue.trim().length < 2}
                            className="font-label rounded-full bg-[var(--ink)] px-4 py-2 text-[11px] text-white transition hover:translate-y-[-1px] disabled:opacity-40"
                          >
                            {editSaving ? "SAVING…" : "SAVE"}
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <p className="mt-2 text-sm leading-7 text-[var(--ink)]">{c.body}</p>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </section>
  );
}

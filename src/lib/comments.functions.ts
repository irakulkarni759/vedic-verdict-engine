import { createServerFn } from "@tanstack/react-start";
import { getRequestHeader, getRequestIP } from "@tanstack/react-start/server";
import { getSupabaseServiceClient } from "./supabase.server";

export type Comment = {
  id: string;
  author: string;
  body: string;
  createdAt: string;
  editedAt: string | null;
};

export type AdminComment = Comment & { trendSlug: string };

const MAX_AUTHOR_LEN = 40;
const MAX_BODY_LEN = 1000;

// Rate limits, enforced server-side against Supabase (works across serverless
// instances, unlike an in-memory counter). Keyed off a salted hash of IP —
// the raw IP is never stored.
const SHORT_WINDOW_MS = 20_000; // one comment per 20s per IP
const HOURLY_WINDOW_MS = 60 * 60 * 1000;
const HOURLY_MAX = 15; // max comments per IP per hour

type CommentRow = {
  id: string;
  author: string;
  body: string;
  created_at: string;
  edited_at: string | null;
};

type AdminCommentRow = CommentRow & { trend_slug: string };

function rowToComment(row: CommentRow): Comment {
  return {
    id: row.id,
    author: row.author,
    body: row.body,
    createdAt: row.created_at,
    editedAt: row.edited_at,
  };
}

async function hashIp(ip: string): Promise<string> {
  const salt = process.env.VEDA_COMMENT_IP_SALT ?? "veda-comment-salt";
  const enc = new TextEncoder().encode(`${salt}:${ip}`);
  const digest = await crypto.subtle.digest("SHA-256", enc);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Best-effort client IP, checking Cloudflare's header first, then standard proxy headers. */
function getClientIp(): string {
  return (
    getRequestHeader("cf-connecting-ip") ??
    getRequestIP({ xForwardedFor: true }) ??
    "unknown"
  );
}

export const getComments = createServerFn({ method: "GET" })
  .inputValidator((d: { slug: string }) => d)
  .handler(async ({ data }): Promise<Comment[]> => {
    try {
      const supabase = getSupabaseServiceClient();
      const { data: rows, error } = await supabase
        .from("comments")
        .select("id, author, body, created_at, edited_at")
        .eq("trend_slug", data.slug)
        .order("created_at", { ascending: true })
        .limit(200);
      if (error || !rows) return [];
      return (rows as CommentRow[]).map(rowToComment);
    } catch {
      return [];
    }
  });

export const postComment = createServerFn({ method: "POST" })
  .inputValidator((d: { slug: string; author: string; body: string; website?: string }) => d)
  .handler(async ({ data }): Promise<{ ok: boolean; comment?: Comment; editToken?: string; error?: string }> => {
    // Honeypot: real users never see or fill this field. If it's filled, it's a bot —
    // pretend success without persisting anything, so the bot doesn't learn it was caught.
    if (data.website && data.website.trim().length > 0) {
      return { ok: true };
    }

    const slug = data.slug.trim();
    const author = data.author.trim().slice(0, MAX_AUTHOR_LEN) || "Anonymous";
    const body = data.body.trim().slice(0, MAX_BODY_LEN);

    if (!slug) return { ok: false, error: "Missing trend." };
    if (body.length < 2) return { ok: false, error: "Comment is too short." };

    try {
      const supabase = getSupabaseServiceClient();
      const ip = getClientIp();
      const ipHash = await hashIp(ip);

      if (ip !== "unknown") {
        const { data: recent } = await supabase
          .from("comments")
          .select("created_at")
          .eq("ip_hash", ipHash)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (recent && Date.now() - new Date(recent.created_at).getTime() < SHORT_WINDOW_MS) {
          return { ok: false, error: "You're commenting too fast. Wait a few seconds and try again." };
        }

        const { count } = await supabase
          .from("comments")
          .select("*", { count: "exact", head: true })
          .eq("ip_hash", ipHash)
          .gte("created_at", new Date(Date.now() - HOURLY_WINDOW_MS).toISOString());

        if ((count ?? 0) >= HOURLY_MAX) {
          return { ok: false, error: "You've hit the comment limit for now. Try again later." };
        }
      }

      const { data: row, error } = await supabase
        .from("comments")
        .insert({ trend_slug: slug, author, body, ip_hash: ip === "unknown" ? null : ipHash })
        .select("id, author, body, created_at, edited_at, edit_token")
        .single();

      if (error || !row) return { ok: false, error: "Couldn't post comment. Try again." };

      return {
        ok: true,
        comment: rowToComment(row as CommentRow),
        editToken: (row as CommentRow & { edit_token: string }).edit_token,
      };
    } catch {
      return { ok: false, error: "Couldn't post comment. Try again." };
    }
  });

export const updateComment = createServerFn({ method: "POST" })
  .inputValidator((d: { id: string; editToken: string; body: string }) => d)
  .handler(async ({ data }): Promise<{ ok: boolean; comment?: Comment; error?: string }> => {
    const body = data.body.trim().slice(0, MAX_BODY_LEN);
    if (body.length < 2) return { ok: false, error: "Comment is too short." };
    if (!data.editToken) return { ok: false, error: "Can't edit this comment." };

    try {
      const supabase = getSupabaseServiceClient();
      const { data: row, error } = await supabase
        .from("comments")
        .update({ body, edited_at: new Date().toISOString() })
        .eq("id", data.id)
        .eq("edit_token", data.editToken)
        .select("id, author, body, created_at, edited_at")
        .maybeSingle();

      if (error) return { ok: false, error: "Couldn't save your edit." };
      if (!row) return { ok: false, error: "Can't edit this comment." };

      return { ok: true, comment: rowToComment(row as CommentRow) };
    } catch {
      return { ok: false, error: "Couldn't save your edit." };
    }
  });

export function checkAdminPassword(password: string): boolean {
  const expected = process.env.VEDA_ADMIN_PASSWORD;
  return !!expected && password === expected;
}

export const adminListComments = createServerFn({ method: "POST" })
  .inputValidator((d: { password: string }) => d)
  .handler(async ({ data }): Promise<{ ok: boolean; comments?: AdminComment[]; error?: string }> => {
    if (!checkAdminPassword(data.password)) return { ok: false, error: "Wrong password." };
    try {
      const supabase = getSupabaseServiceClient();
      const { data: rows, error } = await supabase
        .from("comments")
        .select("id, author, body, created_at, edited_at, trend_slug")
        .order("created_at", { ascending: false })
        .limit(300);
      if (error || !rows) return { ok: false, error: "Couldn't load comments." };
      return {
        ok: true,
        comments: (rows as AdminCommentRow[]).map((r) => ({
          ...rowToComment(r),
          trendSlug: r.trend_slug,
        })),
      };
    } catch {
      return { ok: false, error: "Couldn't load comments." };
    }
  });

export const adminDeleteComment = createServerFn({ method: "POST" })
  .inputValidator((d: { password: string; id: string }) => d)
  .handler(async ({ data }): Promise<{ ok: boolean; error?: string }> => {
    if (!checkAdminPassword(data.password)) return { ok: false, error: "Wrong password." };
    try {
      const supabase = getSupabaseServiceClient();
      const { error } = await supabase.from("comments").delete().eq("id", data.id);
      if (error) return { ok: false, error: "Couldn't delete comment." };
      return { ok: true };
    } catch {
      return { ok: false, error: "Couldn't delete comment." };
    }
  });

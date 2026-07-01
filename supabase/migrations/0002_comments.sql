-- Comments on trends (both static TRENDS entries and generated_trends rows).
-- All reads/writes go through the service-role server functions in
-- src/lib/comments.functions.ts, so RLS is enabled with no public policies —
-- the table is inaccessible to the anon/authenticated Supabase keys by design.

create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  trend_slug text not null,
  author text not null default 'Anonymous',
  body text not null,
  ip_hash text, -- SHA-256 hash of the commenter's IP, used only for rate limiting. Never the raw IP.
  created_at timestamptz not null default now()
);

create index if not exists comments_trend_slug_created_at_idx
  on public.comments (trend_slug, created_at asc);

create index if not exists comments_ip_hash_created_at_idx
  on public.comments (ip_hash, created_at desc);

alter table public.comments enable row level security;

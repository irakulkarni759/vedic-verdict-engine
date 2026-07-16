-- Cache for the personalized "FOR YOU" verdict line. Keyed on
-- (trend_slug, profile_hash) so everyone with identical questionnaire
-- answers shares one Haiku call per trend. Only the one-way hash of the
-- profile is stored — never the answers themselves; those live solely in
-- the visitor's localStorage.
--
-- line = '' is a real, cacheable result: it means the model decided the
-- profile doesn't change anything for this trend, and we shouldn't ask again.
--
-- Run this in the Supabase dashboard: Project -> SQL Editor -> New query,
-- paste, Run.

create table if not exists public.personalized_verdicts (
  id uuid primary key default gen_random_uuid(),
  trend_slug text not null,
  profile_hash text not null,
  line text not null default '',
  -- Which profile answers drove the line (question ids, e.g. {climate,skinType}) —
  -- shown as a "based on your climate" hint in the UI.
  based_on text[] not null default '{}',
  created_at timestamptz not null default now(),
  unique (trend_slug, profile_hash)
);

create index if not exists idx_personalized_verdicts_lookup
  on public.personalized_verdicts (trend_slug, profile_hash);

-- Service-role access only (reads and writes both go through server
-- functions) — RLS on with no policies blocks the anon key entirely.
alter table public.personalized_verdicts enable row level security;

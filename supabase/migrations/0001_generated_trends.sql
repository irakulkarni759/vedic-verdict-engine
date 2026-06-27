-- Generated (live-search) trend verdicts. Distinct from the curated TRENDS
-- array shipped in src/data/trends.ts — this table only holds verdicts
-- produced by verifyTrend() for queries with no curated match.
--
-- Run this in the Supabase dashboard: Project -> SQL Editor -> New query,
-- paste, Run. (Or via the Supabase CLI if you set that up later.)

create table if not exists public.generated_trends (
  id text primary key,
  query text not null,
  name text not null,
  category text not null,
  verdict text not null check (verdict in ('backed', 'mixed', 'debunked', 'unmapped')),
  summary text not null,
  study_count integer not null default 0,
  confidence text not null check (confidence in ('low', 'moderate', 'high')),
  last_updated date not null default current_date,
  evidence_points jsonb not null default '[]'::jsonb,
  sentiment_score real not null default 0,
  opinions jsonb not null default '[]'::jsonb,
  related_ids jsonb not null default '[]'::jsonb,
  source_urls jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

-- Cache lookups happen by normalized query text, not id.
create index if not exists generated_trends_query_idx
  on public.generated_trends (query);

alter table public.generated_trends enable row level security;

-- Public read access (lets the frontend query this table directly in future
-- if you want to, e.g. to show "recently generated" trends). All writes go
-- through verifyTrend() using the service-role key, which bypasses RLS — so
-- no insert/update policy is defined for the anon/authenticated roles.
create policy "Public read access" on public.generated_trends
  for select
  using (true);

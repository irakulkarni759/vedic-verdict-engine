-- Tracks how many times each query has been searched, so the homepage
-- "trying now" row can reflect real popularity instead of a hardcoded list.
-- Incremented in saveGeneratedTrend() on every generate/re-generate.
--
-- Run this in the Supabase dashboard: Project -> SQL Editor -> New query,
-- paste, Run.

alter table public.generated_trends
  add column if not exists search_count integer not null default 1;

-- Powers "top searched" ordering for the homepage trending row.
create index if not exists generated_trends_search_count_idx
  on public.generated_trends (search_count desc);

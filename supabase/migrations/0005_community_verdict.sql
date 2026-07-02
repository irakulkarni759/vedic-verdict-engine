-- Adds a dedicated community-sentiment verdict sentence, separate from the
-- research-side summary already stored in `summary`. Powers the two-bullet
-- hero summary (RESEARCH / COMMUNITY) instead of one generic sentence.
--
-- Run this in the Supabase dashboard: Project -> SQL Editor -> New query,
-- paste, Run.

alter table public.generated_trends
  add column if not exists community_verdict text not null default '';

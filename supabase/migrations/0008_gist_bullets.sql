-- Adds short, skimmable "gist" phrase arrays (2-4 fragments, 2-3 words
-- each) for the hero's bulleted research/community summary, separate from
-- the existing single-sentence summary/community_verdict fields. Run this
-- in the Supabase dashboard: Project -> SQL Editor -> New query, paste, Run.

alter table public.generated_trends
  add column if not exists research_gist jsonb,
  add column if not exists community_gist jsonb;

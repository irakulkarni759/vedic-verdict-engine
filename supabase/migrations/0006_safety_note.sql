-- Common side effects / contraindications (e.g. "avoid during pregnancy",
-- "interacts with thyroid medication"), shown as a third SAFETY line on
-- the hero summary alongside RESEARCH and COMMUNITY. Empty string means
-- nothing notable was found for typical healthy-adult use.
--
-- Run this in the Supabase dashboard: Project -> SQL Editor -> New query,
-- paste, Run.

alter table public.generated_trends
  add column if not exists safety_note text not null default '';

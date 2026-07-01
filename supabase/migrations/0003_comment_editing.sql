-- Lets a commenter edit their own comment later without any auth system:
-- each comment gets a random edit_token at creation time, returned once to
-- the poster's browser and stored in their localStorage. Editing requires
-- that exact token, checked server-side. edit_token is never included in
-- public reads (see getComments in comments.functions.ts).

alter table public.comments
  add column if not exists edit_token uuid not null default gen_random_uuid(),
  add column if not exists edited_at timestamptz;

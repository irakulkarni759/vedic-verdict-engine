-- Per-user saved wellness profile, so a signed-in visitor's answers follow
-- them across devices (the localStorage copy is still the runtime source;
-- this is the durable, cross-device backup keyed to their account).
--
-- Auth is Supabase magic-link email. Each row is owned by one auth.users id,
-- and RLS restricts every operation to the owner — the public anon key used
-- by the browser can only ever read/write the caller's own row.
--
-- Run this in the Supabase dashboard: Project -> SQL Editor -> New query,
-- paste, Run. (Requires migration 0009 to have been run for personalization;
-- this one is independent of it but part of the same feature.)

create table if not exists public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  -- The questionnaire answers, same shape as the localStorage profile
  -- (questionId -> value | value[]). Validated app-side before write.
  profile jsonb not null default '{}',
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Owner-only access. auth.uid() is the signed-in user's id from their JWT;
-- these policies make it impossible to see or change anyone else's row.
create policy "Read own profile"
  on public.profiles for select
  using (auth.uid() = user_id);

create policy "Insert own profile"
  on public.profiles for insert
  with check (auth.uid() = user_id);

create policy "Update own profile"
  on public.profiles for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

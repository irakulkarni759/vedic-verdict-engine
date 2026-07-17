-- Waitlist for personalized suggestions. Instead of accounts/login, visitors
-- optionally drop their email on the profile page; we store it alongside a
-- snapshot of their questionnaire answers so we can email them tailored
-- suggestions later. One row per email (re-submitting updates their answers).
--
-- Writes go through a server function using the service-role key, so RLS is
-- on with no policies (the public anon key can't read or write this table —
-- emails are not publicly listable).
--
-- Run this in the Supabase dashboard: Project -> SQL Editor -> New query,
-- paste, Run.

create table if not exists public.waitlist (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  -- Snapshot of the questionnaire answers at signup (questionId -> value |
  -- value[]), used to personalize what we send them. Validated app-side.
  profile jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_waitlist_email on public.waitlist (email);

alter table public.waitlist enable row level security;

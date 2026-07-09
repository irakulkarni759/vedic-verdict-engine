-- Previously only a lossy summary was stored (evidence_points as plain
-- strings, no study type/limitations/detail, no ingredient breakdown at
-- all). That meant every single page visit to a search result fully
-- regenerated it from scratch — PubMed, Reddit, and 2-3 Claude calls, every
-- time, even for the exact same query a minute later — which is slow, costs
-- API spend on every repeat view, and can come back subtly different each
-- time since the underlying calls aren't deterministic (a bullet's wording,
-- an ingredient's verdict, etc. could shift between two generations of the
-- "same" result). This adds the columns needed to cache the FULL result
-- so a repeat visit can be served straight from the row instead of
-- regenerating, and gets back byte-for-byte the same thing it saw before.
--
-- Run this in the Supabase dashboard: Project -> SQL Editor -> New query,
-- paste, Run.

alter table public.generated_trends
  add column if not exists bullets jsonb not null default '[]'::jsonb,
  add column if not exists articles jsonb not null default '[]'::jsonb,
  add column if not exists pubmed_search_url text not null default '',
  add column if not exists reddit_search_url text not null default '',
  add column if not exists generated_at timestamptz not null default now(),
  add column if not exists ingredient_fallback jsonb,
  add column if not exists ingredient_breakdown jsonb,
  add column if not exists ingredient_source jsonb;

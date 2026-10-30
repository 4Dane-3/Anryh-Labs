-- The campaign start flow: the agent answers a few questions (what they sell, who they write, how they
-- take calls) and picks a daily budget; Migz picks the length and lays out its plan.
--
-- Run once in the Supabase SQL editor. Safe to run again (every change is "if not exists").

-- The answers, saved on the agent and prefilled next time. Shape (all optional except products):
-- { products: string[], ageMin: int, ageMax: int, minPremium: int (dollars a month),
--   underwriting: "exam" | "simplified" | "both", healthIssuesOk: bool, languages: string[],
--   contact: "phone" | "in_person" | "both", callTimes: string[] }
alter table public.agents
  add column if not exists campaign_answers jsonb;

-- What Migz planned for a campaign when it started (what it learned, what it will change, the expected
-- range), shown on the Brain page while the campaign runs
alter table public.campaign_batches
  add column if not exists plan jsonb;

-- Every ad Meta rejects, with Meta's reasons and the words on the ad, so Migz (and staff) learn which
-- phrasings fail on agent accounts
create table if not exists public.ad_rejections (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.agents (id) on delete cascade,
  meta_ad_id text not null unique,
  reasons jsonb not null default '[]',
  primary_text text,
  headline text,
  hook_line text,
  created_at timestamptz not null default now()
);

create index if not exists ad_rejections_agent_idx on public.ad_rejections (agent_id, created_at desc);
alter table public.ad_rejections enable row level security;

notify pgrst, 'reload schema';

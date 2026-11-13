-- Competitor research, run by Migz from /admin/competitors. For one roofer: the top roofers on Google Maps in their
-- service area and in a benchmark market (Dublin, where Europe makes Meta and Google show real reach), every ad
-- those competitors run on Google and Facebook/Instagram (through Apify), the page behind each, a ranking of the
-- winners and their real offers, the roofer's own proof (site, Google reviews, testimonials, videos), and ads that
-- beat the competitors: 150 headlines through three filters, a blind buyer test and a 9/10 publish gate.

create table if not exists public.competitor_runs (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.agents (id) on delete cascade,
  status text not null default 'running' check (status in ('running', 'done', 'failed', 'canceled')),
  stage text not null default 'maps', -- maps, homepages, ads, read, rank, context, write, buyer, judge, done
  markets jsonb not null default '[]'::jsonb,
  jobs jsonb not null default '[]'::jsonb, -- Apify runs: [{ key, actor, runId, status, usd, meta }]
  advertisers jsonb not null default '[]'::jsonb,
  ads jsonb not null default '[]'::jsonb,
  pages jsonb not null default '[]'::jsonb,
  drafts jsonb, -- the new ads: every headline with its filter result, the kept 15, matchups, the landing page, the verdict
  progress jsonb not null default '{}'::jsonb, -- where a long step is up to between runs
  published jsonb,
  budget_usd numeric not null default 10,
  cost_usd numeric not null default 0,
  log jsonb not null default '[]'::jsonb, -- [{ at, text }], newest last
  error text,
  claimed_at timestamptz,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz
);
create index if not exists competitor_runs_agent_idx on public.competitor_runs (agent_id, created_at desc);
create index if not exists competitor_runs_open_idx on public.competitor_runs (status) where status = 'running';

-- What Migz knows about the roofer for its ads: the business, what it can prove (and can't), Google reviews,
-- testimonials and videos. Rebuilt by each research run; Migz's reviews and ad writing read it.
create table if not exists public.agent_ad_context (
  agent_id uuid primary key references public.agents (id) on delete cascade,
  context jsonb not null,
  built_at timestamptz not null default now()
);

alter table public.competitor_runs enable row level security;
alter table public.agent_ad_context enable row level security;

notify pgrst, 'reload schema';

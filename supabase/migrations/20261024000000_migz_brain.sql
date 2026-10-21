-- Migz brain: richer Meta perception (video, delivery, placements), landing-page visits, a step-by-step
-- event log for every run, per-call model costs, creative traits, experiments, learnings, audit findings
-- and the market swipe file. Like every other table here: RLS on, no policies, service role only.

-- 1. Per-ad daily insights: video, delivery and click quality (Meta Insights API, level=ad)
alter table public.ad_insights_daily
  add column reach int not null default 0,
  add column frequency numeric(8, 3) not null default 0,
  add column link_clicks int not null default 0,
  add column video_plays int not null default 0,
  add column video_3s_views int not null default 0, -- actions[action_type=video_view]
  add column thruplays int not null default 0,
  add column video_p25 int not null default 0,
  add column video_p50 int not null default 0,
  add column video_p75 int not null default 0,
  add column video_p100 int not null default 0,
  add column avg_watch_ms int not null default 0,
  add column landing_page_views int not null default 0; -- Meta's count; our own visits are in page_visits

-- 2. Per-ad daily results by placement (breakdowns=publisher_platform,platform_position)
create table public.ad_placement_daily (
  agent_id uuid not null references public.agents (id) on delete cascade,
  meta_ad_id text not null,
  date date not null,
  publisher_platform text not null,
  platform_position text not null,
  spend_cents int not null default 0,
  impressions int not null default 0,
  link_clicks int not null default 0,
  video_3s_views int not null default 0,
  thruplays int not null default 0,
  primary key (meta_ad_id, date, publisher_platform, platform_position)
);

create index ad_placement_agent_date_idx on public.ad_placement_daily (agent_id, date);

-- 3. Visits to agent pages, with the ad that sent them (utm_content = Meta ad id)
create table public.page_visits (
  id bigint generated always as identity primary key,
  agent_id uuid not null references public.agents (id) on delete cascade,
  utm_source text,
  utm_content text,
  created_at timestamptz not null default now()
);

create index page_visits_agent_idx on public.page_visits (agent_id, created_at);

-- 4. Runs: why a run skipped the models, what it cost
alter table public.migz_runs
  add column skipped_reason text,
  add column cost_usd numeric(10, 4) not null default 0;

alter table public.migz_runs drop constraint migz_runs_status_check;
alter table public.migz_runs add constraint migz_runs_status_check
  check (status in ('running', 'succeeded', 'failed', 'skipped'));

-- 5. Step events: what each run did, as it happened (drives the Brain page)
create table public.migz_events (
  id bigint generated always as identity primary key,
  agent_id uuid not null references public.agents (id) on delete cascade,
  run_id uuid references public.migz_runs (id) on delete cascade,
  step text not null check (step in (
    'syncing', 'auditing', 'triaging', 'researching', 'watching', 'advising',
    'hypothesizing', 'drafting', 'checking', 'acting', 'remembering', 'finished', 'skipped'
  )),
  tier text not null check (tier in ('code', 'haiku', 'sonnet', 'opus', 'higgsfield')),
  model text,
  summary text not null,
  evidence jsonb not null default '{}',
  input_tokens int not null default 0,
  output_tokens int not null default 0,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

create index migz_events_agent_idx on public.migz_events (agent_id, id desc);
create index migz_events_run_idx on public.migz_events (run_id, id);

-- 6. Every model call, for cost tracking and the monthly ceiling
create table public.model_calls (
  id bigint generated always as identity primary key,
  agent_id uuid references public.agents (id) on delete cascade, -- null for shared work (market research)
  run_id uuid references public.migz_runs (id) on delete set null,
  task text not null,
  tier text not null check (tier in ('haiku', 'sonnet', 'opus')),
  model text not null,
  input_tokens int not null default 0,
  output_tokens int not null default 0,
  cache_read_tokens int not null default 0,
  cache_write_tokens int not null default 0,
  cost_usd numeric(10, 5) not null default 0,
  latency_ms int not null default 0,
  degraded boolean not null default false, -- ran on a cheaper tier because of the monthly ceiling
  created_at timestamptz not null default now()
);

create index model_calls_agent_month_idx on public.model_calls (agent_id, created_at);

-- 7. Agents: monthly model budget and routine bookkeeping
alter table public.agents
  add column migz_model_budget_cents int not null default 3000 check (migz_model_budget_cents >= 0),
  add column migz_last_operator_at timestamptz,
  add column migz_last_daily_at timestamptz,
  add column migz_last_fatigue_at timestamptz,
  add column migz_last_weekly_at timestamptz;

-- 8. Creative traits from the vision tier
alter table public.creatives
  add column traits jsonb,
  add column traits_at timestamptz;

-- 9. Experiments and what they taught us. Per agent only: Meta data is never pooled across agents.
create table public.experiments (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.agents (id) on delete cascade,
  run_id uuid references public.migz_runs (id) on delete set null,
  hypothesis text not null,
  rationale text not null,
  lever text not null check (lever in ('hook', 'body', 'copy', 'offer', 'format', 'placement', 'budget')),
  success_metric text not null check (success_metric in ('cost_per_booked_call', 'hook_rate', 'hold_rate', 'link_ctr', 'visit_to_booking')),
  variants jsonb not null default '[]', -- [{label, ad_id}]
  min_impressions int not null,
  min_thruplays int not null default 0,
  status text not null default 'planned' check (status in ('planned', 'running', 'concluded')),
  verdict text check (verdict in ('winner', 'no_difference', 'inconclusive')),
  winner_label text,
  result jsonb,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  concluded_at timestamptz
);

create index experiments_agent_idx on public.experiments (agent_id, status);

create table public.learnings (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.agents (id) on delete cascade,
  insight text not null,
  evidence jsonb not null default '{}',
  confidence text not null check (confidence in ('low', 'medium', 'high')),
  source text not null check (source in ('experiment', 'market', 'memo', 'review')),
  experiment_id uuid references public.experiments (id) on delete set null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create index learnings_agent_idx on public.learnings (agent_id, active, created_at desc);

-- 10. Auditor findings: one open row per check + subject, refreshed each run
create table public.audit_findings (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.agents (id) on delete cascade,
  check_name text not null,
  subject text not null default '',
  severity text not null check (severity in ('info', 'warn', 'critical')),
  summary text not null,
  evidence jsonb not null default '{}',
  status text not null default 'open' check (status in ('open', 'resolved')),
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  resolved_at timestamptz,
  unique (agent_id, check_name, subject)
);

create index audit_findings_open_idx on public.audit_findings (agent_id, status);

-- 11. Swipe file: external ads for inspiration. agent_id null = shared market research (public info);
-- otherwise added by that agent. Never contains an agent's own Meta data.
create table public.swipe_files (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid references public.agents (id) on delete cascade,
  source_url text,
  advertiser text,
  notes text,
  traits jsonb, -- same schema as creatives.traits
  added_by text not null check (added_by in ('scout', 'agent', 'migz')),
  created_at timestamptz not null default now()
);

create index swipe_files_agent_idx on public.swipe_files (agent_id, created_at desc);

alter table public.ad_placement_daily enable row level security;
alter table public.page_visits enable row level security;
alter table public.migz_events enable row level security;
alter table public.model_calls enable row level security;
alter table public.experiments enable row level security;
alter table public.learnings enable row level security;
alter table public.audit_findings enable row level security;
alter table public.swipe_files enable row level security;

notify pgrst, 'reload schema';

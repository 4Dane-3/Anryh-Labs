-- Migz engine: per-agent Meta assets, a mirror of the Meta campaign tree, per-ad daily insights,
-- Higgsfield creative generation jobs, Migz run records, and approvable actions.
-- Like every other table here: RLS on, no policies, server (service role) access only.

-- 1. Agents: which Meta assets Migz manages for them, and how much autonomy it has
alter table public.agents
  add column meta_ad_account_id text check (meta_ad_account_id ~ '^act_[0-9]+$'),
  add column meta_page_id text,
  add column meta_instagram_id text,
  -- off: Migz does nothing. approve: Migz proposes, the agent approves. auto: Migz applies within guardrails.
  add column migz_mode text not null default 'approve' check (migz_mode in ('off', 'approve', 'auto')),
  add column migz_last_run_at timestamptz;

-- 2. Mirror of what Migz has launched on Meta (Meta is the source of truth; synced each run)
create table public.ad_campaigns (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.agents (id) on delete cascade,
  meta_campaign_id text not null unique,
  name text not null,
  status text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.ad_sets (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.agents (id) on delete cascade,
  campaign_id uuid not null references public.ad_campaigns (id) on delete cascade,
  meta_adset_id text not null unique,
  name text not null,
  status text not null,
  daily_budget_cents int not null,
  placements text[] not null default '{}', -- empty = Advantage+ (automatic) placements
  learning_status text, -- Meta learning_stage_info.status, e.g. LEARNING / SUCCESS / FAIL
  last_edited_at timestamptz not null default now(), -- significant edits restart Meta's learning phase
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index ad_sets_agent_idx on public.ad_sets (agent_id);

-- 3. Creatives: uploads and Migz-generated media, plus what Meta knows about each
alter table public.creatives
  add column source text not null default 'upload' check (source in ('upload', 'migz')),
  add column parent_creative_id uuid references public.creatives (id) on delete set null,
  add column hook text,
  add column script jsonb, -- Migz's brief: hook shot + body shots + ad copy, reused for hook variants
  add column meta_video_id text,
  add column meta_image_hash text;

create table public.ads (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.agents (id) on delete cascade,
  adset_id uuid not null references public.ad_sets (id) on delete cascade,
  creative_id uuid references public.creatives (id) on delete set null,
  meta_ad_id text not null unique,
  meta_creative_id text,
  name text not null,
  status text not null,
  primary_text text,
  headline text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index ads_agent_idx on public.ads (agent_id);

-- 4. Per-ad daily performance from Meta Insights. Booked calls per ad come from our own
-- bookings (utm_content = ad id), which is more reliable than Meta's attributed count.
create table public.ad_insights_daily (
  agent_id uuid not null references public.agents (id) on delete cascade,
  meta_ad_id text not null,
  date date not null,
  spend_cents int not null default 0,
  impressions int not null default 0,
  clicks int not null default 0,
  meta_conversions int not null default 0,
  primary key (meta_ad_id, date)
);

create index ad_insights_agent_date_idx on public.ad_insights_daily (agent_id, date);

-- 5. Migz runs (one per review cycle) and the actions they take or propose
create table public.migz_runs (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.agents (id) on delete cascade,
  trigger text not null default 'schedule' check (trigger in ('schedule', 'manual')),
  status text not null default 'running' check (status in ('running', 'succeeded', 'failed')),
  summary text,
  model text,
  input_tokens int,
  output_tokens int,
  error text,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

create index migz_runs_agent_idx on public.migz_runs (agent_id, started_at desc);

alter table public.ad_actions
  add column status text not null default 'applied'
    check (status in ('proposed', 'applied', 'rejected', 'failed', 'expired')),
  add column tool text,
  add column payload jsonb,
  add column result jsonb,
  add column run_id uuid references public.migz_runs (id) on delete set null,
  add column decided_at timestamptz;

create index ad_actions_status_idx on public.ad_actions (agent_id, status);

-- 6. Higgsfield generation jobs. Each moves: generating -> stored -> (meta_processing -> launched) | failed
create table public.creative_jobs (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.agents (id) on delete cascade,
  action_id uuid references public.ad_actions (id) on delete set null,
  provider_request_id text unique,
  status_url text,
  stage text not null default 'generating'
    check (stage in ('generating', 'stored', 'meta_processing', 'launched', 'failed')),
  brief jsonb not null,
  parent_creative_id uuid references public.creatives (id) on delete set null,
  creative_id uuid references public.creatives (id) on delete set null,
  launch_adset_id text, -- Meta ad set to launch into once ready; null = keep in the library
  attempts int not null default 0,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index creative_jobs_open_idx on public.creative_jobs (stage) where stage not in ('launched', 'failed');

alter table public.ad_campaigns enable row level security;
alter table public.ad_sets enable row level security;
alter table public.ads enable row level security;
alter table public.ad_insights_daily enable row level security;
alter table public.migz_runs enable row level security;
alter table public.creative_jobs enable row level security;

notify pgrst, 'reload schema';

-- Campaign batches, live Brain activity, licensed-state targeting and carousels.

-- 1. A batch is a block of ad money the agent puts toward a run of campaigns. Migz plans how to spend it
--    (one focused campaign, one per focus, or spread wide) and for how long (at least 14 days).
--    'planned' is a batch chosen during setup that starts with "Start my campaign".
create table public.campaign_batches (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.agents (id) on delete cascade,
  status text not null default 'planned' check (status in ('planned', 'active', 'ended', 'canceled')),
  budget_cents int not null check (budget_cents > 0), -- ad spend (after the fee)
  option text not null check (option in ('focused', 'balanced', 'spread')),
  campaigns text[] not null, -- the focus topic of each campaign, in order ('' = no topic)
  days int not null check (days >= 14),
  daily_cents int not null check (daily_cents > 0),
  recommended_option text,
  reason text, -- Migz's reason for its recommendation
  starts_on date,
  ends_on date,
  applied_at timestamptz, -- when Migz set the account's campaigns up for this batch
  result jsonb, -- spend and booked calls when it ended
  created_at timestamptz not null default now(),
  started_at timestamptz,
  ended_at timestamptz
);

create unique index campaign_batches_one_open on public.campaign_batches (agent_id) where status in ('planned', 'active');
create index campaign_batches_agent_idx on public.campaign_batches (agent_id, created_at desc);
alter table public.campaign_batches enable row level security;

-- 2. Campaigns a batch doesn't use are paused and marked retired, so going live doesn't switch them back on.
alter table public.ad_campaigns add column retired_at timestamptz;

-- 3. The licensed states an ad set targets, so Migz re-targets it when the agent's states change.
alter table public.ad_sets add column states text[];

-- 4. Creative jobs: the Brain event that's open while the job works (Higgsfield, then Meta), and the
--    per-card generations of a carousel.
alter table public.creative_jobs
  add column event_id bigint,
  add column parts jsonb;

notify pgrst, 'reload schema';

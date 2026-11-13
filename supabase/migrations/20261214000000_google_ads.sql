-- Google Ads, run by Migz. A roofer links their own Google Ads account to Anryh Labs' manager account (or we make
-- one under it, with them as admin). They pay Google directly with their own card; the monthly cap they set here
-- is a hard limit Migz never budgets past. Migz builds one Search campaign, syncs the numbers daily, reviews the
-- account (search terms, keywords, ads, budget, bidding) and uploads booked inspections and closed jobs as
-- conversions so Google learns who actually buys.

create table if not exists public.google_ads_accounts (
  agent_id uuid primary key references public.agents (id) on delete cascade,
  customer_id text not null check (customer_id ~ '^\d{10}$'),
  -- pending: link request sent, waiting for them to accept in Google Ads; linked: we can manage it;
  -- created: we made it under our manager account (they still add billing); refused / ended: link turned down or removed
  link_status text not null default 'pending' check (link_status in ('pending', 'linked', 'created', 'refused', 'ended')),
  link_resource text, -- customers/{manager}/customerClientLinks/{client}~{id}
  invite_email text, -- who was invited as admin when we made the account
  monthly_cap_cents integer not null default 150000 check (monthly_cap_cents between 0 and 5000000),
  enabled boolean not null default true, -- the roofer can pause Google without unlinking
  campaign_id text, -- the Search campaign Migz built
  budget_resource text, -- its campaign budget
  conversion_actions jsonb not null default '{}'::jsonb, -- { booked, call, closed }: conversion action resource names
  launched_at timestamptz,
  last_budget_change_at timestamptz,
  last_bidding_change_at timestamptz,
  snapshot jsonb, -- the last sync: what the review reads
  synced_at timestamptz,
  reviewed_at timestamptz,
  review_claimed_at timestamptz,
  failed_at timestamptz,
  fail_count integer not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Daily results per campaign, for the dashboard and the review's trends
create table if not exists public.google_ads_daily (
  agent_id uuid not null references public.agents (id) on delete cascade,
  day date not null,
  campaign_id text not null,
  cost_cents integer not null default 0,
  clicks integer not null default 0,
  impressions integer not null default 0,
  conversions numeric not null default 0,
  primary key (agent_id, day, campaign_id)
);

-- Every change Migz makes or proposes in Google Ads (ask-first roofers approve the proposed ones)
create table if not exists public.google_ads_actions (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.agents (id) on delete cascade,
  tool text not null,
  payload jsonb not null default '{}'::jsonb,
  title text not null,
  reason text,
  status text not null default 'applied' check (status in ('proposed', 'applying', 'applied', 'rejected', 'failed', 'expired')),
  result jsonb,
  created_at timestamptz not null default now(),
  decided_at timestamptz
);
create index if not exists google_ads_actions_agent_idx on public.google_ads_actions (agent_id, created_at desc);

-- Which bookings were sent to Google as conversions (the click id is in bookings.attribution: gclid, gbraid, wbraid)
alter table public.bookings
  add column if not exists google_booked_sent_at timestamptz,
  add column if not exists google_closed_sent_at timestamptz;

-- The roofer's average job, the value sent with a closed job (null = $12,000)
alter table public.agents add column if not exists avg_job_dollars integer check (avg_job_dollars is null or avg_job_dollars between 100 and 1000000);

alter table public.google_ads_accounts enable row level security;
alter table public.google_ads_daily enable row level security;
alter table public.google_ads_actions enable row level security;

notify pgrst, 'reload schema';

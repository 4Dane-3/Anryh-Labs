-- Migz talks to clients by text and Slack, remakes videos from their notes, and can put the roofer on screen.
-- Needs 20261208000000_video_approvals.sql first.

alter table public.agents
  add column if not exists sms_phone text,
  add column if not exists sms_opt_in_at timestamptz;
create index if not exists agents_sms_phone_idx on public.agents (sms_phone) where sms_phone is not null;

alter table public.creative_jobs add column if not exists revision_count int not null default 0;

-- Every message between a client and Migz, in and out; external_id stops a retried webhook being handled twice
create table if not exists public.migz_messages (
  id bigint generated always as identity primary key,
  agent_id uuid not null references public.agents (id) on delete cascade,
  channel text not null check (channel in ('sms', 'slack')),
  direction text not null check (direction in ('in', 'out')),
  body text not null,
  external_id text unique,
  created_at timestamptz not null default now()
);
create index if not exists migz_messages_agent_idx on public.migz_messages (agent_id, created_at desc);
alter table public.migz_messages enable row level security;

-- How the roofer appears in their videos. Photos and voice only ever come from them, with consent recorded.
create table if not exists public.agent_presenters (
  agent_id uuid primary key references public.agents (id) on delete cascade,
  mode text not null default 'none' check (mode in ('film', 'ai', 'none')),
  photo_paths text[] not null default '{}',
  job_photo_paths text[] not null default '{}',
  film_path text,
  voice_sample_path text,
  elevenlabs_voice_id text,
  offer text,
  badge text,
  towns text[] not null default '{}',
  consent_name text,
  consent_at timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.agent_presenters enable row level security;

-- Migz AI by the month ($1,000, no setup fee, no fee on ad funds). Accounts without it keep the percentage.
alter table public.agents
  add column if not exists migz_plan text check (migz_plan in ('percent', 'subscription')),
  add column if not exists stripe_subscription_id text,
  add column if not exists subscription_status text,
  add column if not exists subscription_period_end timestamptz;
create unique index if not exists agents_stripe_subscription_idx on public.agents (stripe_subscription_id) where stripe_subscription_id is not null;

notify pgrst, 'reload schema';

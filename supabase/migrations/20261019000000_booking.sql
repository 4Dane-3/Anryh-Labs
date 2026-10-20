-- Booking system for agent landing pages (/[slug]).
-- All tables are RLS-locked with no policies: only the server (service role key) reads or writes them.

create extension if not exists btree_gist;

create table public.agents (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique
    check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
    check (slug not in (
      'api', 'admin', 'dashboard', 'login', 'signup', 'about', 'contact',
      'careers', 'pairo', 'privacy', 'status', 'write', 'terms'
    )),
  full_name text not null,
  headline text,
  bio text,
  photo_url text,
  license_number text,
  licensed_states text[] not null default '{}',
  email text not null,
  timezone text not null default 'America/New_York',
  slot_minutes int not null default 30 check (slot_minutes between 10 and 120),
  buffer_minutes int not null default 0 check (buffer_minutes between 0 and 120),
  min_notice_hours int not null default 4 check (min_notice_hours >= 0),
  max_days_ahead int not null default 21 check (max_days_ahead between 1 and 90),
  slack_user_id text,
  digest_hour int not null default 8 check (digest_hour between 0 and 23),
  last_digest_date date,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Weekly recurring hours in the agent's timezone. weekday is ISO: 1 = Monday ... 7 = Sunday.
create table public.availability_rules (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.agents (id) on delete cascade,
  weekday int not null check (weekday between 1 and 7),
  start_time time not null,
  end_time time not null,
  check (end_time > start_time)
);

create index availability_rules_agent_idx on public.availability_rules (agent_id);

create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.agents (id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'confirmed' check (status in ('confirmed', 'cancelled')),
  name text not null,
  email text not null,
  phone text not null,
  consent_text text not null,
  consented_at timestamptz not null default now(),
  -- unguessable token that gates the prepare page and calendar download
  token uuid not null default gen_random_uuid() unique,
  -- utm params, fbclid, _fbp/_fbc cookies: kept so we can send Conversions API events later
  attribution jsonb not null default '{}',
  created_at timestamptz not null default now(),
  check (ends_at > starts_at),
  -- the database, not the app, guarantees an agent can never be double-booked
  exclude using gist (
    agent_id with =,
    tstzrange(starts_at, ends_at) with &&
  ) where (status = 'confirmed')
);

create index bookings_agent_starts_idx on public.bookings (agent_id, starts_at);

create table public.intake_responses (
  booking_id uuid primary key references public.bookings (id) on delete cascade,
  date_of_birth date,
  gender text,
  marital_status text,
  nicotine text,
  existing_coverage text,
  policy_description text,
  goal text,
  reason text,
  budget text,
  coverage_amount text,
  best_time_to_reach text,
  notes text,
  submitted_at timestamptz not null default now()
);

alter table public.agents enable row level security;
alter table public.availability_rules enable row level security;
alter table public.bookings enable row level security;
alter table public.intake_responses enable row level security;

-- The booked-call guarantee: an agent's first 30 days from launch. Kept funded (a month of ad funds, ads running),
-- on their Anryh Labs booking page with their calendar open, they get at least `target` booked calls (8, or 12 at
-- $75/day or more), or the Anryh Labs fee on the funds they added is credited back once staff approve it.

create table if not exists public.booking_guarantees (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.agents (id) on delete cascade,
  starts_on date not null,                -- the day the campaign launched (agent's timezone)
  ends_on date not null,                  -- the 30th day
  daily_cents int not null,               -- the daily budget at launch: sets the target and the month of funds
  target int not null,                    -- booked calls promised
  status text not null default 'running'
    check (status in ('running', 'met', 'missed', 'ineligible', 'refunded', 'declined')),
  bookings int,                           -- booked calls counted when it ended
  fee_cents int,                          -- the Anryh Labs fee on funds added up to the end: the refund on a miss
  unmet text[] not null default '{}',     -- conditions not met (why it's ineligible)
  evaluated_at timestamptz,
  decided_at timestamptz,                 -- staff approved or declined the refund
  decided_by text,
  created_at timestamptz not null default now(),
  unique (agent_id, starts_on)
);

create index if not exists booking_guarantees_running_idx on public.booking_guarantees (status, ends_on);

alter table public.booking_guarantees enable row level security;

-- What visitors do on an agent's booking page, for the admin dashboard's page analytics: one row per
-- step (viewed, saw the times, picked a day or time, started the form, booked, how far they scrolled,
-- how long they stayed). A visit is a random id kept for one browser tab session: no IP address, no
-- cookie, nothing that identifies the person. Service role only (no RLS policies).
create table public.page_events (
  id bigint generated always as identity primary key,
  agent_id uuid not null references public.agents (id) on delete cascade,
  session_id text not null,
  name text not null check (name in (
    'view', 'scroll', 'see_calendar', 'pick_day', 'pick_soonest', 'pick_time', 'form_start',
    'form_continue', 'submit', 'booked', 'booking_error', 'sticky_click', 'bio_expand', 'leave'
  )),
  meta jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index page_events_agent_idx on public.page_events (agent_id, created_at desc);
create index page_events_session_idx on public.page_events (session_id);

alter table public.page_events enable row level security;

notify pgrst, 'reload schema';

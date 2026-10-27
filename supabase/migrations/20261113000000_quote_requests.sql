-- "Get a free quote" on the booking page: a lighter step than picking a time, for visitors who aren't ready to
-- book. They leave a name and phone, the agent calls back. Each request is also sent to Meta as a Lead event
-- (bookings send one too), so ad sets can optimize on an event that happens often enough to learn from.
create table public.quote_requests (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.agents (id) on delete cascade,
  name text not null,
  phone text not null, -- E.164, US
  coverage text, -- what they're interested in (final expense, whole life, term, not sure)
  best_time text, -- morning / afternoon / evening
  consent_text text not null,
  consented_at timestamptz not null default now(),
  -- utm params, fbclid, _fbp/_fbc cookies, as on bookings
  attribution jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index quote_requests_agent_created on public.quote_requests (agent_id, created_at desc);

alter table public.quote_requests enable row level security;

-- page_events: add 'quote_open' and 'quote_submit'. The name check was created inline (unnamed), so find it by definition.
do $$
declare c text;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.page_events'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%see_calendar%'
  loop
    execute format('alter table public.page_events drop constraint %I', c);
  end loop;
end $$;

alter table public.page_events add constraint page_events_name_check check (name in (
  'view', 'scroll', 'see_calendar', 'pick_day', 'pick_soonest', 'pick_time', 'form_start',
  'form_continue', 'submit', 'booked', 'booking_error', 'sticky_click', 'bio_expand', 'leave', 'call_click',
  'quote_open', 'quote_submit'
));

-- Migz's calls on the conversion path: how the page shows the quote option (set_quote_option), and which
-- event each ad set optimizes for (set_optimization_event). Ad sets made before this optimize for SCHEDULE;
-- new ones are created for LEAD.
alter table public.agents
  add column quote_mode text not null default 'folded' check (quote_mode in ('folded', 'open_for_ads', 'off'));

alter table public.ad_sets
  add column optimization_event text not null default 'SCHEDULE' check (optimization_event in ('SCHEDULE', 'LEAD'));

notify pgrst, 'reload schema';

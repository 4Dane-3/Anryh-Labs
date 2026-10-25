-- "Call now" on the booking page: an agent can add a button that phones them straight from their page,
-- shown all the time or only during their working hours. Each tap is tracked as a page event.
alter table public.agents
  add column call_button boolean not null default false,
  add column call_phone text check (call_phone is null or call_phone ~ '^\+1[0-9]{10}$'), -- E.164, US
  add column call_hours_only boolean not null default true;

-- page_events: add 'call_click'. The name check was created inline (unnamed), so find it by definition.
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
  'form_continue', 'submit', 'booked', 'booking_error', 'sticky_click', 'bio_expand', 'leave', 'call_click'
));

notify pgrst, 'reload schema';

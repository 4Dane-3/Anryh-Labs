-- Roofing: the same Migz, for roofing companies booking free roof inspections.
-- An account is either an insurance agent (the default) or a roofer. Roofers target a radius around their
-- service area instead of licensed states, can run two inspection crews at once, can send each booking to
-- their CRM, and can mark an inspection "Not a homeowner".

alter table public.agents
  add column if not exists vertical text not null default 'insurance' check (vertical in ('insurance', 'roofing')),
  add column if not exists service_area text,                 -- the address, city or ZIP the radius is centered on
  add column if not exists service_radius_miles int check (service_radius_miles between 5 and 50),
  add column if not exists crews smallint not null default 1 check (crews between 1 and 2), -- inspections at the same time
  add column if not exists crm_webhook_url text,              -- each booking is POSTed here (Zapier, Make, a CRM)
  add column if not exists company_license text;              -- contractor license shown on the page and postcards

-- Which crew an inspection is on. Each crew can't be double-booked, so a roofer with 2 crews gets 2 per time.
alter table public.bookings
  add column if not exists crew smallint not null default 1 check (crew between 1 and 2),
  add column if not exists roofer_reminded_at timestamptz,    -- the morning-of email to the roofer
  add column if not exists crm_sent_at timestamptz,
  add column if not exists crm_error text;

-- Replace the one-booking-per-time rule with one per crew per time (crew 1 for everyone else, so nothing changes)
do $$
declare c text;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.bookings'::regclass and contype = 'x'
  loop
    execute format('alter table public.bookings drop constraint %I', c);
  end loop;
end $$;

alter table public.bookings add constraint bookings_no_overlap_per_crew
  exclude using gist (agent_id with =, crew with =, tstzrange(starts_at, ends_at) with &&) where (status = 'confirmed');

-- "Not a homeowner" joins the call outcomes (a booked inspection at a rental, so the roofer can't sell it)
do $$
declare c text;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.bookings'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%no_show%'
  loop
    execute format('alter table public.bookings drop constraint %I', c);
  end loop;
end $$;

alter table public.bookings add constraint bookings_outcome_check
  check (outcome in ('showed_up', 'no_show', 'quoted', 'sold', 'not_interested', 'not_homeowner'));

-- Clients the agent adds by hand: someone who called them directly, a referral, a past client. They join the
-- same Clients list as Migz's leads (source 'manual'), with how they found the agent, and are never sent to
-- Meta, emailed by us, or counted in Migz's ad results. Safe to run again.
do $$
declare c text;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.quote_requests'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%instant_form%'
  loop
    execute format('alter table public.quote_requests drop constraint %I', c);
  end loop;
end $$;

alter table public.quote_requests add constraint quote_requests_source_check check (source in ('page', 'instant_form', 'manual'));

alter table public.quote_requests
  add column if not exists personal_source text check (char_length(personal_source) <= 120);

notify pgrst, 'reload schema';

-- "Jobs we take": the kinds of jobs a roofer accepts. Emma's speed-to-lead calls and the booking page both follow
-- them, and the server (not the AI) decides who fits. Empty (null) means no rules: everything gets through.
-- Run once in the Supabase SQL editor. Safe to run again. Needs 20261202000000_speed_to_lead_voice.sql first.

alter table public.agents
  add column if not exists job_rules jsonb;

-- Whether a lead or booking fit the rules, and why not (reasons) or what to check at the inspection (flags)
alter table public.quote_requests
  add column if not exists fit_status text,
  add column if not exists fit_detail jsonb,
  add column if not exists fit_facts jsonb;

alter table public.bookings
  add column if not exists fit_status text,
  add column if not exists fit_detail jsonb;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'quote_requests_fit_status_check') then
    alter table public.quote_requests add constraint quote_requests_fit_status_check check (fit_status is null or fit_status in ('fit', 'not_fit', 'unsure'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'bookings_fit_status_check') then
    alter table public.bookings add constraint bookings_fit_status_check check (fit_status is null or fit_status in ('fit', 'not_fit', 'unsure'));
  end if;
end $$;

notify pgrst, 'reload schema';

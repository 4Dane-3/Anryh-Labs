-- The check-in email also carries the roofer's Google review link. Set per account in Settings.
-- Needs 20261203000000_job_checkin_referrals.sql first. Run once in the Supabase SQL editor. Safe to run again.

alter table public.agents
  add column if not exists google_review_url text;

notify pgrst, 'reload schema';

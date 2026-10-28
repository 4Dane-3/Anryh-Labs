-- Migz run safety: one review at a time per agent, backoff after failed reviews, and creative jobs that
-- remember the Meta objects they made (so a retried launch never makes a second live ad).
-- The code works before this runs (unlocked, no backoff, as before).

alter table public.agents
  add column if not exists migz_run_claimed_at timestamptz, -- a review is running (stale after 6 minutes)
  add column if not exists migz_failed_at timestamptz,      -- last failed review; scheduled reviews back off
  add column if not exists migz_fail_count int not null default 0;

alter table public.creative_jobs
  add column if not exists meta_creative_id text,
  add column if not exists meta_ad_id text;

-- Approving a proposal claims it first ("applying"), so a double click can't apply it twice
alter table public.ad_actions drop constraint if exists ad_actions_status_check;
alter table public.ad_actions add constraint ad_actions_status_check
  check (status in ('proposed', 'applying', 'applied', 'rejected', 'failed', 'expired'));

notify pgrst, 'reload schema';

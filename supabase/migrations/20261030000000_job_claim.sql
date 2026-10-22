-- Creative jobs are advanced by the Higgsfield webhook, the 10-minute cron and the approval flow, and
-- two of them could run the same job at once (a duplicate ad, or a duplicate-key failure). A job is now
-- claimed before it's advanced; the claim expires on its own so a crashed run can't block it forever.
alter table public.creative_jobs add column claimed_at timestamptz;

notify pgrst, 'reload schema';

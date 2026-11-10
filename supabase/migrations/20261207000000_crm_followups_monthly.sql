-- CRM follow-ups get a "Monthly retainer" cadence: one email a month with no end, until the client
-- unsubscribes or staff stop it (for prospects who went elsewhere, so they remember us).
-- Needs 20261206000000_crm_follow_up_emails.sql first.

alter table public.crm_followups drop constraint if exists crm_followups_cadence_check;
alter table public.crm_followups add constraint crm_followups_cadence_check check (cadence in ('daily', 'every_2_days', 'twice_monthly', 'monthly'));

notify pgrst, 'reload schema';

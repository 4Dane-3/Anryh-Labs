-- When the agent was told in Slack that Meta finished reviewing an ad (approved or not), so each ad's
-- review result is sent once. Ads that already exist are marked as told: only new ads get the message.
alter table public.ads add column review_notified_at timestamptz;
update public.ads set review_notified_at = now();

notify pgrst, 'reload schema';

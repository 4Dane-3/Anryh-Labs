-- Exploration campaigns. A batch can run a main campaign plus a smaller exploration campaign: new,
-- untested creative launches there first, and Migz promotes proven ads into the main campaign, so the
-- main ad set isn't restarted by every test.

-- 1. The batch option that runs both ('explore'); campaign_batches.campaigns marks the exploration
--    campaign as 'explore' alongside the main campaign's topic ('' = all focus topics).
alter table public.campaign_batches drop constraint campaign_batches_option_check;
alter table public.campaign_batches
  add constraint campaign_batches_option_check check (option in ('focused', 'balanced', 'spread', 'explore'));

-- 2. What each campaign is for. Existing campaigns are all main ones.
alter table public.ad_campaigns
  add column role text not null default 'main' check (role in ('main', 'explore'));

notify pgrst, 'reload schema';

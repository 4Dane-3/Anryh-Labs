-- "Start here" onboarding: an editable job title for the booking page, the campaign plan (how long it
-- runs), how the agent wants creatives made, and when they finished setting up.
alter table public.agents
  add column title text check (title is null or char_length(title) <= 80), -- null = "Licensed life insurance agent"
  add column campaign_days int check (campaign_days is null or campaign_days between 0 and 365), -- null = not chosen yet, 0 = ongoing
  add column campaign_started_on date,
  add column campaign_ends_on date, -- Migz pauses ads after this day
  add column creative_mode text check (creative_mode in ('upload', 'ai', 'both')),
  add column onboarding_completed_at timestamptz;

notify pgrst, 'reload schema';

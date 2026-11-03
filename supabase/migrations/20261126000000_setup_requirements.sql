-- What Start here asks for before anything else: the agent's business details, their Meta ad account and
-- Page (shared with Anryh Labs' Business Manager), where their ads send people, their Slack, and (last)
-- how Migz runs their ads.

alter table public.agents
  add column if not exists agency_name text,                 -- the agency or IMO they write through
  add column if not exists npn text,                         -- National Producer Number (optional)
  add column if not exists business_email text,              -- where leads' replies go (null = their login email)
  add column if not exists booking_choice text check (booking_choice in ('ours', 'own')), -- null until they choose
  add column if not exists own_booking_url text,             -- their own booking page, when booking_choice = 'own'
  add column if not exists meta_ad_account_requested text,   -- the ad account they said they shared (act_...)
  add column if not exists meta_page_requested text,         -- the Facebook Page they said they shared (ID or link)
  add column if not exists meta_access_requested_at timestamptz, -- when they said they sent the partner request
  add column if not exists migz_mode_chosen_at timestamptz;  -- when they chose automatic or ask-first in Start here

-- Agents who already finished setup keep running on their page here, and have already chosen a mode
update public.agents
  set booking_choice = coalesce(booking_choice, 'ours'),
      migz_mode_chosen_at = coalesce(migz_mode_chosen_at, onboarding_completed_at)
  where onboarding_completed_at is not null;

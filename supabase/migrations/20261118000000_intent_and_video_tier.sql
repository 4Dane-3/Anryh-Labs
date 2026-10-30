-- Two agent choices that shape how Migz builds their ads.
--
-- Intent level: "medium_high" (the standard) sends every ad to the booking page to book a call.
-- "low_medium" also lets Migz run Meta instant forms (lead ads with a form on Facebook/Instagram):
-- more, cheaper leads that are less ready to talk. Form leads land in quote_requests with source
-- 'instant_form', so they show with the agent's other call-backs and ping their Slack.
--
-- Video quality: "standard" is Kling 3.0 at 720p, included. "seedance_15" / "seedance_30" make videos on
-- Seedance 2.5 at 720p; each one is charged to the agent's ad funds (a wallet line per video, refunded if
-- the generation fails), so the choice and price are shown before they agree.

alter table public.agents
  add column if not exists intent_level text not null default 'medium_high' check (intent_level in ('low_medium', 'medium_high')),
  add column if not exists video_tier text not null default 'standard' check (video_tier in ('standard', 'seedance_15', 'seedance_30')),
  -- The instant form Migz made on the agent's Page (one per agent, reused by every form ad)
  add column if not exists meta_lead_form_id text,
  -- Why the last attempt to make that form failed (e.g. the Page hasn't accepted Meta's lead ads terms)
  add column if not exists lead_form_blocked text;

-- Where an ad set sends people: the booking page (website) or an instant form on Meta (on_ad)
alter table public.ad_sets
  add column if not exists destination text not null default 'website' check (destination in ('website', 'instant_form'));

-- Instant-form leads share the call-back list with "Get a free quote" requests
alter table public.quote_requests
  add column if not exists source text not null default 'page' check (source in ('page', 'instant_form')),
  add column if not exists email text,
  add column if not exists meta_lead_id text unique,
  add column if not exists meta_form_id text,
  add column if not exists meta_ad_id text,
  -- When this lead later booked a call (sent to Meta as a CRM conversion on the lead)
  add column if not exists booked_at timestamptz;

create index if not exists quote_requests_agent_phone on public.quote_requests (agent_id, phone);

-- Which model made each video, and what the agent was charged for it (cents; 0 when included)
alter table public.creative_jobs
  add column if not exists video_model text,
  add column if not exists video_charge_cents int not null default 0;

notify pgrst, 'reload schema';

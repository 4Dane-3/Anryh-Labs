-- Setup asks roofing or insurance first, then roofers get their own steps: the CRM they book in, the lead goal
-- (free roof inspection or free quote), and their special, which Migz re-confirms every week.
-- Needs 20261210000000_presenter_on_camera.sql first.

alter table public.agents
  add column if not exists vertical_chosen_at timestamptz,
  add column if not exists crm text,
  add column if not exists lead_goal text check (lead_goal in ('inspection', 'quote'));

-- Accounts that already finished setup chose long ago
update public.agents set vertical_chosen_at = onboarding_completed_at where vertical_chosen_at is null and onboarding_completed_at is not null;

-- The weekly "is your special still running?" check: when Migz last asked, and when the roofer last said yes
alter table public.agent_brand
  add column if not exists special_asked_at timestamptz,
  add column if not exists special_confirmed_at timestamptz;

-- The creatives bucket also holds audio (the presenter's voiceover and voice sample, the edit's music and sound
-- effects) and the edit plan (JSON); without these types those uploads are refused
update storage.buckets
set allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/quicktime', 'video/webm',
  'audio/mpeg', 'audio/mp4', 'audio/x-m4a', 'audio/wav', 'audio/x-wav', 'audio/webm', 'application/json']
where id = 'creatives';

notify pgrst, 'reload schema';

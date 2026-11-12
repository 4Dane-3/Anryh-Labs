-- Ad Creative AI Context. The voice their ads are spoken in: one they picked from ElevenLabs' voices (by id), or
-- 'own' for their cloned voice. And their own job photos and clips, each with what it shows (crew working, an
-- inspection, damage, a finished roof, drone, the team), so the edit cuts to the one that matches what's being
-- said and image ads can use the real photo. Needs 20261209000000_roofer_autopilot.sql first.

alter table public.agent_presenters
  add column if not exists job_media jsonb not null default '[]'::jsonb, -- [{ "path", "kind", "type": "photo" | "video" }]
  add column if not exists ad_voice_id text, -- an ElevenLabs voice id, or 'own' (their cloned voice)
  add column if not exists ad_voice_name text; -- "Lyan", for the setup summary

notify pgrst, 'reload schema';

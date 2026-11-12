-- The person on camera at a jobsite: their photo becomes a HeyGen photo avatar, and from it a "look" of them standing
-- at a roofing job (waist up, company hoodie, crew and truck behind), which every presenter video is made from.
-- Also how to say their name, so the voice gets it right. Needs 20261211000000_roofer_setup.sql first.

alter table public.agent_presenters
  add column if not exists on_camera_pronunciation text,
  add column if not exists heygen_avatar_id text,
  add column if not exists heygen_group_id text,
  add column if not exists heygen_look_id text,
  add column if not exists look_status text check (look_status in ('processing', 'completed', 'failed')),
  add column if not exists look_preview_url text,
  add column if not exists look_photo_path text; -- the photo the look was made from (a new photo makes a new look)

notify pgrst, 'reload schema';

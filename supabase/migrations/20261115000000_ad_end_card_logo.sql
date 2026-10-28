-- The logo shown as the last shot of an agent's Migz videos: the scene blurs and zooms out while the logo
-- fades in. It's a file in the creatives bucket (<agent id>/brand/logo.png); null = no end card.
alter table public.agents add column ad_logo_path text;

notify pgrst, 'reload schema';

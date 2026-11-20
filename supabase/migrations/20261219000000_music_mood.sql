-- The background music a client picks for their videos (src/lib/edit/music.ts). 'none' turns music off.
alter table public.agent_brand
  add column if not exists music_mood text not null default 'soft'
    check (music_mood in ('soft', 'upbeat', 'educational', 'inspiring', 'luxury', 'none'));

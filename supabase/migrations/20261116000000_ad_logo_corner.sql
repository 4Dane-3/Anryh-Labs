-- Which corner of every Migz ad the agent's small logo sits in (top_right keeps it clear of the Reels and Stories
-- top bar and the caption at the bottom).
alter table public.agents
  add column ad_logo_corner text not null default 'top_right'
    check (ad_logo_corner in ('top_left', 'top_right', 'bottom_left', 'bottom_right'));

notify pgrst, 'reload schema';

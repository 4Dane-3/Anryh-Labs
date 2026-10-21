-- What each agent wants Migz to advertise (topic keys from src/lib/migz/topics.ts), most important
-- first. Empty = Migz picks from the proven angles.
alter table public.agents
  add column ad_focus text[] not null default '{}';

notify pgrst, 'reload schema';

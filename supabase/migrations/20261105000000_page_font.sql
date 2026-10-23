-- The font of an agent's booking page, picked in My page. Arial by default.
alter table public.agents add column page_font text not null default 'arial'
  check (page_font in ('arial', 'nunito', 'inter', 'lato', 'georgia', 'manifold'));

notify pgrst, 'reload schema';

-- The address a roofer's ads send people to, on their own domain (like book.theirroofing.com), served by us.
alter table public.agents add column if not exists ad_domain text;
alter table public.agents add column if not exists ad_domain_ok boolean not null default false;
create unique index if not exists agents_ad_domain_key on public.agents (lower(ad_domain)) where ad_domain is not null;

-- An account whose ad funds are all used (the unspent part of its batch isn't backed by real money):
-- its dashboard stops showing batch money as set aside or left. The ads keep running to the batch's end.
alter table public.agents add column if not exists funds_used_up boolean not null default false;

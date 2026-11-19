-- Counts requests per bucket (an IP, or a phone number) in a rolling window, for the public forms and
-- webhooks-free endpoints. Only the server (service role) touches this table; nothing else can read or write it.
create table if not exists public.rate_limits (
  bucket text primary key,
  window_start timestamptz not null,
  hits integer not null default 0
);

alter table public.rate_limits enable row level security;

-- Adds one hit to the bucket and returns true while it's within the limit. Atomic, so parallel requests can't
-- slip past the count.
create or replace function public.rate_limit_hit(p_bucket text, p_window_seconds integer, p_max integer)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
  v_hits integer;
begin
  insert into public.rate_limits as r (bucket, window_start, hits)
  values (p_bucket, v_now, 1)
  on conflict (bucket) do update set
    window_start = case when r.window_start < v_now - make_interval(secs => p_window_seconds) then v_now else r.window_start end,
    hits = case when r.window_start < v_now - make_interval(secs => p_window_seconds) then 1 else r.hits + 1 end
  returning hits into v_hits;

  return v_hits <= p_max;
end;
$$;

revoke all on function public.rate_limit_hit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.rate_limit_hit(text, integer, integer) to service_role;

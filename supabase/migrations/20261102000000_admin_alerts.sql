-- The admin dashboard's alerts: problems Migz spots across every agent (a failed review or creative,
-- a paused campaign, a rejected ad, an ad account that can't spend, ...). One open row per problem
-- (by key); it closes when the problem goes away or staff mark it handled. Staff get one Slack ping
-- per new problem. Service role only: no RLS policies, so agents can never read it.
create table public.admin_alerts (
  id bigint generated always as identity primary key,
  agent_id uuid references public.agents (id) on delete cascade,
  key text not null,
  source text not null check (source in ('scan', 'event')),
  severity text not null check (severity in ('critical', 'warn', 'info')),
  title text not null,
  detail text,
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by text,
  slack_sent_at timestamptz
);

create unique index admin_alerts_open_key on public.admin_alerts (key) where resolved_at is null;
create index admin_alerts_recent_idx on public.admin_alerts (first_seen desc);

alter table public.admin_alerts enable row level security;

-- The health scan that fills it: every 10 minutes, offset from the creative jobs so they don't overlap
select cron.schedule(
  'admin-health-scan',
  '5-59/10 * * * *',
  $$
  select net.http_get(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'app_url') || '/api/cron/health',
    headers := jsonb_build_object(
      'Authorization',
      'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    timeout_milliseconds := 300000
  );
  $$
);
-- Stop it: select cron.unschedule('admin-health-scan');

notify pgrst, 'reload schema';

-- Migz's nightly summary: at 9pm in each agent's own timezone, a Slack message about the day (spend,
-- results, what Migz changed or is thinking, and how their booking page can convert better). Each night
-- is saved here, and the "thoughts" Migz is accumulating (things it plans to change or test once the
-- first week of results is in) carry from one night to the next. Service role only (no RLS policies).
create table public.nightly_summaries (
  id bigint generated always as identity primary key,
  agent_id uuid not null references public.agents (id) on delete cascade,
  local_date date not null, -- the agent's own calendar day this summary is about
  phase text not null check (phase in ('collecting', 'revising', 'none')),
  numbers jsonb not null default '{}', -- spend, budget, impressions, clicks, booked calls, batch progress
  thoughts jsonb not null default '[]', -- Migz's running thoughts as of tonight
  changes jsonb not null default '[]', -- what Migz changed today (after the first week)
  page jsonb not null default '{}', -- booking page findings and the week's page analytics
  narrative jsonb not null default '{}', -- the headline, what happened, what's next
  cost_usd numeric(10, 4) not null default 0,
  slack_sent_at timestamptz,
  created_at timestamptz not null default now(),
  unique (agent_id, local_date)
);

create index nightly_summaries_agent_idx on public.nightly_summaries (agent_id, local_date desc);

alter table public.nightly_summaries enable row level security;

-- Hourly, at 7 past: each agent whose local time has reached 9pm gets one summary for their day
select cron.schedule(
  'agent-nightly-summary',
  '7 * * * *',
  $$
  select net.http_get(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'app_url') || '/api/cron/nightly',
    headers := jsonb_build_object(
      'Authorization',
      'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    timeout_milliseconds := 300000
  );
  $$
);
-- Stop it: select cron.unschedule('agent-nightly-summary');

notify pgrst, 'reload schema';

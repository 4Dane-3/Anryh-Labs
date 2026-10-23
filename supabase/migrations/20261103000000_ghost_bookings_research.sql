-- 1. Ghost bookings: an agent setting that holds back some open times on the booking page.
alter table public.agents add column ghost_bookings boolean not null default false;

-- 2. Migz's research shift: around the clock, Haiku studies ads and buyer psychology for each agent
-- (web search every other cycle), checks it against the account's own history, and drafts the next
-- creative idea. One row per cycle, moved forward one step every 10 minutes. Reviews read the latest
-- notes when they make new creatives; good ideas go to the agent in Slack.
create table public.research_notes (
  id bigint generated always as identity primary key,
  agent_id uuid not null references public.agents (id) on delete cascade,
  stage text not null default 'studying' check (stage in ('studying', 'comparing', 'drafting', 'saving', 'done', 'failed')),
  topic text not null,
  angle text not null,
  web boolean not null default false,
  finding text,
  sources jsonb not null default '[]',
  history text,
  fit text check (fit in ('strong', 'maybe', 'weak')),
  idea jsonb,
  compliance text,
  slack_sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index research_notes_agent_idx on public.research_notes (agent_id, created_at desc);

-- Agents read their own notes (the Brain shows them); writes are server-side only
alter table public.research_notes enable row level security;
create policy "agents read their research" on public.research_notes
  for select using (agent_id in (select id from public.agents where user_id = auth.uid()));

-- 3. The shift itself: every 10 minutes, offset from the other jobs
select cron.schedule(
  'agent-research-shift',
  '2-59/10 * * * *',
  $$
  select net.http_get(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'app_url') || '/api/cron/research',
    headers := jsonb_build_object(
      'Authorization',
      'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    timeout_milliseconds := 300000
  );
  $$
);
-- Stop it: select cron.unschedule('agent-research-shift');

notify pgrst, 'reload schema';

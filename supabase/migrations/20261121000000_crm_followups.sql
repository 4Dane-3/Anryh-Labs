-- CRM follow-ups: a nudge when an invite sits unconfirmed, a reminder an hour before, what happened at
-- the meeting (showed / no-show / rescheduled), and tasks (a next step with a due date) per client.

-- Each send is claimed with a timestamp before it goes out, like reminder_sent_at, so the
-- every-15-minutes cron can't send one twice. They reset when a new invite or a new time goes out.
alter table public.crm_meetings
  add column if not exists nudge_sent_at timestamptz,
  add column if not exists hour_reminder_sent_at timestamptz,
  add column if not exists outcome text check (outcome in ('showed', 'no_show', 'rescheduled')),
  add column if not exists outcome_at timestamptz,
  add column if not exists rebook_sent_at timestamptz,
  -- The client pressed "Ask for another time" on their /meet page after a no-show
  add column if not exists reschedule_requested_at timestamptz;

create table if not exists public.crm_tasks (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.crm_clients (id) on delete cascade,
  meeting_id uuid references public.crm_meetings (id) on delete set null,
  title text not null check (length(title) between 1 and 200),
  due_on date not null,
  done_at timestamptz,
  created_by text,
  created_at timestamptz not null default now()
);

create index if not exists crm_tasks_open_due on public.crm_tasks (due_on) where done_at is null;
create index if not exists crm_tasks_client on public.crm_tasks (client_id, due_on);

-- Service role only, like the other crm_ tables
alter table public.crm_tasks enable row level security;

notify pgrst, 'reload schema';

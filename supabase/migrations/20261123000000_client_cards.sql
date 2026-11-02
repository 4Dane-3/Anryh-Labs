-- Client cards: everyone who reached the agent (booked calls, instant-form leads, quote requests) gets a status
-- (prospect, current plan, not interested), notes, and an activity timeline the agent can add to ("tried to
-- call", "left a voicemail"). "Not interested" becomes an outcome Meta is told about, and the agent can turn
-- on follow-up emails: "sorry I missed you" when they log a missed call, and short follow-ups every 48 hours.
--
-- Run once in the Supabase SQL editor. Safe to run again (every change is "if not exists" or replaces itself).

-- Status: every lead starts as a prospect; "current" has a plan with the agent
alter table public.quote_requests
  add column if not exists client_status text not null default 'prospect' check (client_status in ('prospect', 'current', 'not_interested')),
  add column if not exists agent_notes text,
  -- The "sorry I missed you" email, sent once per lead
  add column if not exists tried_email_sent_at timestamptz;

alter table public.bookings
  add column if not exists client_status text not null default 'prospect' check (client_status in ('prospect', 'current', 'not_interested')),
  add column if not exists tried_email_sent_at timestamptz;

-- "Not interested" joins the outcomes (the checks were created inline, so find them by definition)
do $$
declare c text;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.quote_requests'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%not_reached%'
  loop
    execute format('alter table public.quote_requests drop constraint %I', c);
  end loop;
  for c in
    select conname from pg_constraint
    where conrelid = 'public.bookings'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%no_show%'
  loop
    execute format('alter table public.bookings drop constraint %I', c);
  end loop;
end $$;

alter table public.quote_requests add constraint quote_requests_outcome_check
  check (outcome in ('reached', 'not_reached', 'booked', 'sold', 'not_interested'));
alter table public.bookings add constraint bookings_outcome_check
  check (outcome in ('showed_up', 'no_show', 'quoted', 'sold', 'not_interested'));

-- What happened with each client, newest first on their card. The agent's own entries (a call attempt, a
-- voicemail, a text, a note) can be edited or deleted; the system's (emails sent, outcomes, what Meta was
-- told) are the record and stay as they are.
create table if not exists public.client_activities (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.agents (id) on delete cascade,
  -- Whose card: a form lead or quote request ("lead", quote_requests.id) or a booked call ("call", bookings.id)
  subject_kind text not null check (subject_kind in ('lead', 'call')),
  subject_id uuid not null,
  kind text not null check (kind in ('tried_call', 'voicemail', 'texted', 'note', 'outcome', 'status', 'email', 'meta')),
  body text,
  by_agent boolean not null default false,
  at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists client_activities_subject on public.client_activities (subject_kind, subject_id, at desc);
create index if not exists client_activities_agent on public.client_activities (agent_id, at desc);
alter table public.client_activities enable row level security;

-- Follow-up emails: off until the agent turns them on, with an optional line of their own in the "sorry I
-- missed you" email. When on, a lead who hasn't been reached also gets up to 3 short follow-ups, at least 48
-- hours apart, during the agent's daytime, until they book, are reached, or are marked not interested.
alter table public.agents
  add column if not exists followup_emails boolean not null default false,
  add column if not exists followup_message text;

alter table public.quote_requests
  -- The 48-hour follow-ups sent so far (at most 3)
  add column if not exists followups_sent int not null default 0,
  -- The last email this lead got from the agent (any kind), so follow-ups stay 48 hours apart
  add column if not exists last_emailed_at timestamptz;

create index if not exists quote_requests_followup_due on public.quote_requests (agent_id, created_at)
  where email is not null and booked_at is null and followups_sent < 3;

notify pgrst, 'reload schema';

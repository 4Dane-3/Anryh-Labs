-- CRM follow-up emails: staff start a check-in sequence for a client (daily, every 48 hours or twice a
-- month), each email recaps the Anryh Labs offer and process and asks if they'd like to talk. The
-- every-15-minutes crm-reminders cron sends what's due. Stops on its own when the client unsubscribes,
-- gets a meeting, becomes a client or is marked lost, or after the set number of emails.

-- What the emails say (empty = the built-in defaults in src/lib/crm/followups.ts), the button, and the
-- postal address every commercial email has to carry (CAN-SPAM).
alter table public.crm_settings
  add column if not exists followup_offer text,
  add column if not exists followup_process text,
  add column if not exists followup_cta_url text,
  add column if not exists followup_cta_label text,
  add column if not exists postal_address text;

-- The unsubscribe link's key (unguessable, one per client) and when they used it
alter table public.crm_clients
  add column if not exists unsubscribed_at timestamptz,
  add column if not exists email_token text not null default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
create unique index if not exists crm_clients_email_token_key on public.crm_clients (email_token);

-- One sequence per client
create table if not exists public.crm_followups (
  client_id uuid primary key references public.crm_clients (id) on delete cascade,
  cadence text not null check (cadence in ('daily', 'every_2_days', 'twice_monthly')),
  status text not null default 'active' check (status in ('active', 'paused', 'stopped', 'finished')),
  stop_reason text,
  max_emails int not null default 6 check (max_emails between 1 and 30),
  sent_count int not null default 0,
  next_send_at timestamptz,
  last_sent_at timestamptz,
  sending_at timestamptz, -- claimed by a cron run, so two overlapping runs can't send the same email
  started_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists crm_followups_due on public.crm_followups (next_send_at) where status = 'active';

-- Every follow-up email, for the client's history
create table if not exists public.crm_followup_emails (
  id bigint generated always as identity primary key,
  client_id uuid not null references public.crm_clients (id) on delete cascade,
  step int not null,
  subject text not null,
  to_email text not null,
  outcome text not null check (outcome in ('sent', 'logged', 'failed')),
  error text,
  sent_at timestamptz not null default now()
);
create index if not exists crm_followup_emails_client on public.crm_followup_emails (client_id, sent_at desc);

-- Service role only, like the other crm_ tables
alter table public.crm_followups enable row level security;
alter table public.crm_followup_emails enable row level security;

notify pgrst, 'reload schema';

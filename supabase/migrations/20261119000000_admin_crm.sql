-- The admin CRM: staff's own clients list (with CSV import and their own columns), a notes thread per
-- client, and meetings with an invite email the client confirms from a link. Separate from agents'
-- prospect bookings (public.bookings). Service role only, like the other admin tables: RLS on and no
-- policies, so only server code that has already checked isAnryhAdmin() can read or write it.

-- Columns staff add themselves ("Said yes / Said maybe / Said no", a follow-up date, ...). A client's
-- values live in crm_clients.custom, keyed by the column's id, so renaming a column keeps its values.
create table public.crm_columns (
  id uuid primary key default gen_random_uuid(),
  label text not null check (length(label) between 1 and 60),
  type text not null check (type in ('text', 'select', 'checkbox', 'date', 'number')),
  options jsonb not null default '[]'::jsonb, -- for 'select': [{ "value": "Said yes", "color": "good" }, ...]
  position int not null default 0,
  created_at timestamptz not null default now()
);

create table public.crm_clients (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 1 and 200),
  email text,
  phone text,
  company text,
  status text not null default 'lead' check (status in ('lead', 'contacted', 'meeting', 'client', 'lost')),
  custom jsonb not null default '{}'::jsonb,
  source text not null default 'manual' check (source in ('manual', 'csv')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One client per email and per phone (digits only), which is also how CSV imports skip duplicates
create unique index crm_clients_email_key on public.crm_clients (lower(email)) where email is not null;
create unique index crm_clients_phone_key on public.crm_clients (regexp_replace(phone, '\D', '', 'g')) where phone is not null;
create index crm_clients_created_idx on public.crm_clients (created_at desc);

create table public.crm_notes (
  id bigint generated always as identity primary key,
  client_id uuid not null references public.crm_clients (id) on delete cascade,
  body text not null check (length(body) between 1 and 10000),
  author text not null,
  created_at timestamptz not null default now()
);

create index crm_notes_client_idx on public.crm_notes (client_id, created_at desc);

-- invited -> confirmed (the client pressed Confirm) or cancelled (either side). 'draft' = saved, no email yet.
create table public.crm_meetings (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.crm_clients (id) on delete cascade,
  title text not null check (length(title) between 1 and 200),
  starts_at timestamptz not null,
  ends_at timestamptz not null check (ends_at > starts_at),
  timezone text not null, -- the zone the time was set in, and the one the email shows
  meeting_url text,
  meeting_details text, -- meeting ID, passcode, dial-in: anything to show under the link
  description text,
  status text not null default 'draft' check (status in ('draft', 'invited', 'confirmed', 'cancelled')),
  token text not null unique default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''), -- the client's confirm link (unguessable)
  zoom_meeting_id text,
  sequence int not null default 0, -- bumps on each re-send so calendars update the same event
  invited_at timestamptz,
  confirmed_at timestamptz,
  cancelled_at timestamptz,
  cancelled_by text check (cancelled_by in ('staff', 'client')),
  reminder_sent_at timestamptz,
  created_at timestamptz not null default now()
);

create index crm_meetings_starts_idx on public.crm_meetings (starts_at);
create index crm_meetings_client_idx on public.crm_meetings (client_id, starts_at desc);

-- One row: the default meeting link (a Zoom personal room or Google Meet link), the name invites go out
-- under, where replies go, and the timezone the calendar shows.
create table public.crm_settings (
  id boolean primary key default true check (id),
  meeting_url text,
  meeting_details text,
  from_name text not null default 'Anryh Labs',
  reply_to text,
  timezone text not null default 'America/Los_Angeles',
  default_minutes int not null default 30 check (default_minutes between 5 and 480),
  updated_at timestamptz not null default now()
);

insert into public.crm_settings (id) values (true) on conflict do nothing;

insert into public.crm_columns (label, type, options, position) values
  ('Response', 'select', '[{"value":"Said yes","color":"good"},{"value":"Said maybe","color":"accent"},{"value":"Said no","color":"bad"}]'::jsonb, 0);

alter table public.crm_columns enable row level security;
alter table public.crm_clients enable row level security;
alter table public.crm_notes enable row level security;
alter table public.crm_meetings enable row level security;
alter table public.crm_settings enable row level security;

-- Reminder emails: every 15 minutes, a reminder goes to clients whose meeting starts within 24 hours
select cron.schedule(
  'crm-meeting-reminders',
  '*/15 * * * *',
  $$
  select net.http_get(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'app_url') || '/api/cron/crm-reminders',
    headers := jsonb_build_object(
      'Authorization',
      'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    timeout_milliseconds := 60000
  );
  $$
);
-- Stop it: select cron.unschedule('crm-meeting-reminders');

notify pgrst, 'reload schema';

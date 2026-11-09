-- Speed to lead: an AI voice agent (ElevenLabs Agents over Twilio) calls each new quote request or instant-form
-- lead within seconds, qualifies them and books them onto the calendar. Off per account until turned on in
-- Settings, and only when ELEVENLABS_AGENT_ID / ELEVENLABS_PHONE_NUMBER_ID / ELEVENLABS_WEBHOOK_SECRET are set.
--
-- Run once in the Supabase SQL editor. Safe to run again.

alter table public.agents
  add column if not exists voice_agent boolean not null default false,
  -- The instant form's consent names AI-voice calls. Forms made before this don't, so their leads are never
  -- called by the voice agent; clearing meta_lead_form_id makes Migz build a new form with the new wording.
  add column if not exists meta_lead_form_ai_consent boolean not null default false;

alter table public.quote_requests
  -- What a roofer's "call me about an inspection" form asks (null for insurance quotes)
  add column if not exists address text,
  add column if not exists city text,
  add column if not exists roof_issue text,
  -- Speed-to-lead timestamps. created_at is when the lead was made (Meta's created_time for instant forms);
  -- received_at is when our server got it (the webhook's arrival for Meta, so received_at - created_at is
  -- Meta's delay); inserted_at is when the row was saved.
  add column if not exists received_at timestamptz,
  add column if not exists inserted_at timestamptz default now(),
  -- The voice agent's state for this lead
  add column if not exists voice_status text check (voice_status in (
    'scheduled',     -- a call is due at voice_next_call_at (8am in their time zone, or a no-answer retry)
    'calling',       -- the call request is out / the call is up
    'booked', 'not_qualified', 'callback', 'no_answer', 'do_not_call',
    'failed',        -- ElevenLabs refused the call (bad number, config)
    'skipped'        -- not called (no usable number, on the do-not-call list)
  )),
  add column if not exists voice_next_call_at timestamptz,
  add column if not exists voice_attempts int not null default 0,
  add column if not exists voice_timezone text,      -- the lead's (the browser's), else the account's
  add column if not exists voice_first_call_at timestamptz, -- when the first call request left our server
  add column if not exists voice_booking_id uuid references public.bookings (id) on delete set null;

create index if not exists quote_requests_voice_due on public.quote_requests (voice_next_call_at)
  where voice_status = 'scheduled';

-- One row per call attempt, with its timing (requested → API returned → answered → ended) and what came of it
create table if not exists public.voice_calls (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.quote_requests (id) on delete cascade,
  agent_id uuid not null references public.agents (id) on delete cascade,
  attempt int not null,
  reason text not null check (reason in ('instant', 'scheduled', 'retry')),
  to_number text not null,
  requested_at timestamptz not null,       -- the request to ElevenLabs left our server
  api_returned_at timestamptz,             -- ElevenLabs answered (Twilio is dialing)
  conversation_id text unique,
  call_sid text,
  status text not null default 'requested' check (status in ('requested', 'dialing', 'failed_to_start', 'no_answer', 'answered', 'ended')),
  answered_at timestamptz,                 -- the conversation started (from the post-call data)
  ended_at timestamptz,
  duration_secs int,
  outcome text check (outcome in ('booked', 'not_qualified', 'callback', 'no_answer', 'do_not_call')),
  failure_reason text,
  summary text,
  collected jsonb not null default '{}',   -- the qualifying answers the agent collected
  transcript jsonb,
  booking_id uuid references public.bookings (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists voice_calls_lead on public.voice_calls (lead_id, attempt);
create index if not exists voice_calls_agent on public.voice_calls (agent_id, created_at desc);
alter table public.voice_calls enable row level security;

-- Numbers that must never be called by the voice agent (asked to stop on a call, or added by staff). Global:
-- someone who says "don't call me" is never called again by any account.
create table if not exists public.voice_do_not_call (
  phone text primary key,                  -- E.164
  reason text,
  lead_id uuid references public.quote_requests (id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.voice_do_not_call enable row level security;

-- Every minute: place the calls that are due (8am first calls, no-answer retries). Instant calls don't wait
-- for this; they're placed in the request that saved the lead. Uses the app_url / cron_secret Vault secrets
-- from 20261022000000_digest_cron.sql.
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'voice-calls-due',
  '* * * * *',
  $$
  select net.http_get(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'app_url') || '/api/cron/voice-calls',
    headers := jsonb_build_object(
      'Authorization',
      'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    timeout_milliseconds := 30000
  );
  $$
);

notify pgrst, 'reload schema';

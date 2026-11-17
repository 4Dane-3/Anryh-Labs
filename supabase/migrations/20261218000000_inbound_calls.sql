-- Inbound Emma (the $250/month add-on): a second ElevenLabs agent answers the roofer's incoming calls on a number
-- of ours. Opt in per account in Settings → Inbound calls, choosing how calls reach Emma:
--   forward  their own number forwards to ours when nobody answers (they keep their number everywhere)
--   direct   our number goes on their website, ads and Google profile, and Emma answers every call
--   mix      our number on the ads and landing page only, their own number everywhere else
-- Staff assign the number (bought in Twilio, imported into ElevenLabs, assigned to the inbound agent) on
-- /admin/inbound. Until then nothing is answered. New homeowners are qualified and booked like a form lead; anyone
-- else gets a message taken or a transfer. Every call is summarised by email.
--
-- Run once in the Supabase SQL editor. Safe to run again.

alter table public.agents
  add column if not exists inbound_calls boolean not null default false,
  add column if not exists inbound_mode text check (inbound_mode in ('forward', 'direct', 'mix')),
  add column if not exists inbound_number text,           -- E.164, our Twilio number for this roofer (staff set it)
  add column if not exists inbound_transfer_number text,  -- E.164, where "I want a person" goes (never the forwarded line)
  add column if not exists inbound_summary_email text,    -- where call summaries go (blank: the account's email)
  -- Per-company preferences: { tone: 'casual'|'formal', transfer_existing, transfer_urgent, faqs, notes }
  add column if not exists inbound_prefs jsonb not null default '{}';

create unique index if not exists agents_inbound_number on public.agents (inbound_number) where inbound_number is not null;

-- Inbound callers who are new homeowners become a lead, so the booking tools work exactly as for form leads
do $$
declare c text;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.quote_requests'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%instant_form%'
  loop
    execute format('alter table public.quote_requests drop constraint %I', c);
  end loop;
end $$;
alter table public.quote_requests add constraint quote_requests_source_check check (source in ('page', 'instant_form', 'manual', 'phone'));

-- One row per inbound call
create table if not exists public.inbound_calls (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.agents (id) on delete cascade,
  conversation_id text unique,
  call_sid text,
  from_number text,
  to_number text,
  lead_id uuid references public.quote_requests (id) on delete set null, -- kept only for new homeowners
  caller_type text check (caller_type in ('new_customer', 'existing_customer', 'vendor', 'spam', 'other')),
  outcome text check (outcome in ('booked', 'message', 'transferred', 'not_qualified', 'callback', 'do_not_call', 'hung_up')),
  caller_name text,
  message text,
  summary text,
  collected jsonb not null default '{}',
  transcript jsonb,
  duration_secs int,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  emailed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists inbound_calls_agent on public.inbound_calls (agent_id, created_at desc);
alter table public.inbound_calls enable row level security;

notify pgrst, 'reload schema';

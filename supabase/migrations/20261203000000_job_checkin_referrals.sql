-- Post-job check-in and referrals (roofers). When the roofer marks a job done (the dashboard's "Job done", or a
-- "job completed" webhook from their CRM through Zapier), the voice agent calls the customer about 2 hours later
-- (8am–8pm their time, else the next morning around 10am) to ask how it went. If it went well, the customer is
-- emailed a link to /r/{token}, where they can refer up to 5 friends. 5 valid referrals earn a gift card that the
-- roofer sends by hand. Referred people are never AI-called or auto-texted: they gave no consent. They're kept
-- in their own table, out of quote_requests and the voice queue, for the roofer to call by hand.
--
-- Needs 20261202000000_speed_to_lead_voice.sql first. Run once in the Supabase SQL editor. Safe to run again.

alter table public.agents
  add column if not exists checkin_calls boolean not null default false,
  add column if not exists referral_reward_cents int not null default 10000 check (referral_reward_cents between 0 and 100000),
  add column if not exists referral_goal smallint not null default 5 check (referral_goal between 1 and 10),
  -- One plain email to each referral ("{customer} thought you might need a roofer"), off until turned on
  add column if not exists referral_intro_email boolean not null default false,
  -- The business's postal address: required in any marketing email (CAN-SPAM), so the intro email needs it
  add column if not exists mailing_address text,
  -- The secret for the "job completed" webhook (/api/jobs/completed, header x-job-secret)
  add column if not exists job_webhook_token uuid not null default gen_random_uuid();

create unique index if not exists agents_job_webhook_token on public.agents (job_webhook_token);

alter table public.bookings
  add column if not exists job_done_at timestamptz,
  add column if not exists checkin_status text check (checkin_status in (
    'scheduled',   -- the check-in call is due at checkin_next_call_at
    'calling',     -- the call request is out / the call is up
    'went_well', 'issue', 'callback', 'no_answer', 'do_not_call',
    'email_only',  -- no call (no AI-call consent, on the do-not-call list, calls off): the email went instead
    'failed'       -- ElevenLabs refused the call
  )),
  add column if not exists checkin_next_call_at timestamptz,
  add column if not exists checkin_attempts int not null default 0,
  add column if not exists checkin_rating smallint check (checkin_rating between 1 and 5),
  add column if not exists checkin_feedback text,
  add column if not exists checkin_alerted_at timestamptz,     -- the roofer was told about a problem
  -- The customer's link to /r/{token}, made when the job is marked done
  add column if not exists referral_token uuid unique,
  add column if not exists referral_email_sent_at timestamptz,
  add column if not exists gift_card_owed_at timestamptz,
  add column if not exists gift_card_cents int,
  add column if not exists gift_card_sent_at timestamptz;

create index if not exists bookings_checkin_due on public.bookings (checkin_next_call_at) where checkin_status = 'scheduled';
create index if not exists bookings_gift_cards_owed on public.bookings (agent_id, gift_card_owed_at) where gift_card_owed_at is not null and gift_card_sent_at is null;

-- voice_calls also holds check-in calls: those are about a job (a booking), not a lead
alter table public.voice_calls
  add column if not exists kind text not null default 'speed_to_lead' check (kind in ('speed_to_lead', 'checkin')),
  add column if not exists job_booking_id uuid references public.bookings (id) on delete cascade,
  add column if not exists rating smallint check (rating between 1 and 5);

alter table public.voice_calls alter column lead_id drop not null;

-- The reason and outcome checks were created inline: replace them, found by what they contain
do $$
declare c text;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.voice_calls'::regclass and contype = 'c'
      and (pg_get_constraintdef(oid) ilike '%instant%' or pg_get_constraintdef(oid) ilike '%not_qualified%')
  loop
    execute format('alter table public.voice_calls drop constraint %I', c);
  end loop;
end $$;

alter table public.voice_calls add constraint voice_calls_reason_check
  check (reason in ('instant', 'scheduled', 'retry', 'checkin'));
alter table public.voice_calls add constraint voice_calls_outcome_check
  check (outcome in ('booked', 'not_qualified', 'callback', 'no_answer', 'do_not_call', 'went_well', 'issue'));

alter table public.voice_calls drop constraint if exists voice_calls_subject_check;
alter table public.voice_calls add constraint voice_calls_subject_check
  check ((kind = 'speed_to_lead' and lead_id is not null) or (kind = 'checkin' and job_booking_id is not null));

create index if not exists voice_calls_job on public.voice_calls (job_booking_id, attempt) where job_booking_id is not null;

-- People a happy customer referred. Never called by the voice agent or texted automatically: the roofer calls
-- them by hand. One row per person per roofer (by phone, and by email when given).
create table if not exists public.customer_referrals (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.agents (id) on delete cascade,
  booking_id uuid not null references public.bookings (id) on delete cascade, -- the referring customer's job
  name text not null,
  phone text not null,                     -- E.164
  email text,
  address text,
  -- The customer ticked "I have their permission to share their details"
  permission_text text not null,
  status text not null default 'new' check (status in ('new', 'contacted', 'booked', 'not_interested')),
  crm_sent_at timestamptz,
  crm_error text,
  intro_emailed_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index if not exists customer_referrals_phone on public.customer_referrals (agent_id, phone);
create unique index if not exists customer_referrals_email on public.customer_referrals (agent_id, lower(email)) where email is not null;
create index if not exists customer_referrals_booking on public.customer_referrals (booking_id);
create index if not exists customer_referrals_agent on public.customer_referrals (agent_id, created_at desc);
alter table public.customer_referrals enable row level security;

-- client_activities: a referral note on the referring customer's card uses kind 'note', so nothing changes there.
-- Check-in calls ride the existing every-minute 'voice-calls-due' cron (api/cron/voice-calls).

notify pgrst, 'reload schema';

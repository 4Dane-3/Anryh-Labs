-- Automated emails: the agent writes the emails a lead gets after they tap "Tried to call" or "Sent an email"
-- (subject, body, how many, and how long after the last one each goes out). Each lead or booked call
-- remembers which sequence it's in and how far along it is.

alter table public.agents
  add column if not exists email_sequences jsonb; -- null = the defaults (lib/email-sequences.ts)

alter table public.quote_requests
  add column if not exists email_sequence text check (email_sequence in ('tried_call', 'emailed')),
  add column if not exists sequence_sent int not null default 0,      -- emails of that sequence sent so far
  add column if not exists sequence_started_at timestamptz,           -- when the agent tapped
  add column if not exists sequence_last_at timestamptz;              -- the tap, then each email sent

alter table public.bookings
  add column if not exists email_sequence text check (email_sequence in ('tried_call', 'emailed')),
  add column if not exists sequence_sent int not null default 0,
  add column if not exists sequence_started_at timestamptz,
  add column if not exists sequence_last_at timestamptz;

-- Leads already in the old missed-call follow-ups carry on where they are: "sorry I missed you" was email 1
update public.quote_requests
  set email_sequence = 'tried_call',
      sequence_started_at = tried_email_sent_at,
      sequence_sent = 1 + coalesce(followups_sent, 0),
      sequence_last_at = coalesce(last_emailed_at, tried_email_sent_at)
  where tried_email_sent_at is not null and email_sequence is null;

-- Booked calls only ever got the one missed-call email: theirs count as finished, so no old no-show is
-- suddenly followed up
update public.bookings
  set email_sequence = 'tried_call',
      sequence_started_at = tried_email_sent_at,
      sequence_sent = 99,
      sequence_last_at = tried_email_sent_at
  where tried_email_sent_at is not null and email_sequence is null;

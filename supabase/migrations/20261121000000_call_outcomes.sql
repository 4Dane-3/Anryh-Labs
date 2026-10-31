-- What happened after each lead: did the booked call show up, get a quote, sell? Was the form lead reached?
-- The agent answers with one tap (Slack the morning after, or the dashboard). Migz scores ads on it, and
-- Meta gets a follow-up Conversions API event for the good outcomes, so both learn to find people who buy,
-- not just people who book.
--
-- Run once in the Supabase SQL editor. Safe to run again (every change is "if not exists").

alter table public.bookings
  -- showed_up < quoted < sold are steps forward; no_show is the other answer
  add column if not exists outcome text check (outcome in ('showed_up', 'no_show', 'quoted', 'sold')),
  add column if not exists outcome_at timestamptz,
  -- The monthly premium when it sold (optional), in cents
  add column if not exists premium_cents int check (premium_cents is null or premium_cents >= 0),
  -- The one ask and the one reminder (never more)
  add column if not exists outcome_asked_at timestamptz,
  add column if not exists outcome_reminded_at timestamptz,
  -- The furthest outcome already sent to Meta, so a change of answer never sends twice
  add column if not exists outcome_sent text;

alter table public.quote_requests
  add column if not exists outcome text check (outcome in ('reached', 'not_reached', 'booked', 'sold')),
  add column if not exists outcome_at timestamptz,
  add column if not exists premium_cents int check (premium_cents is null or premium_cents >= 0),
  add column if not exists outcome_asked_at timestamptz,
  add column if not exists outcome_reminded_at timestamptz,
  add column if not exists outcome_sent text;

create index if not exists bookings_outcome_due on public.bookings (agent_id, starts_at) where outcome is null and status = 'confirmed';
create index if not exists quote_requests_outcome_due on public.quote_requests (agent_id, created_at) where outcome is null;

notify pgrst, 'reload schema';

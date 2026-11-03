-- The one-time setup fee: a new agent pays it in Start here before anything else, and the dashboard stays
-- on Start here until it's paid and their first campaign has started. Agents who already finished setup
-- are counted as paid, so nothing changes for them.

alter table public.agents
  add column if not exists setup_fee_paid_at timestamptz,
  add column if not exists setup_fee_session_id text unique; -- the Stripe Checkout session that paid it (null when waived)

update public.agents
  set setup_fee_paid_at = onboarding_completed_at
  where onboarding_completed_at is not null and setup_fee_paid_at is null;

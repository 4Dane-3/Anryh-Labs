-- Auto top-up: an agent saves a card and opts in, and when their free ad balance drops below the level they
-- chose, the card is charged the amount they chose (at most once every 20 hours), so a rolling campaign's
-- next week is always funded. The charge is recorded like any deposit (keyed by the Stripe PaymentIntent).

alter table public.agents
  add column if not exists auto_topup boolean not null default false,
  add column if not exists auto_topup_amount_cents int,          -- what each top-up charges (fee included)
  add column if not exists auto_topup_below_cents int,           -- top up when the free balance drops below this
  add column if not exists stripe_payment_method_id text,        -- the card saved for top-ups
  add column if not exists auto_topup_card text,                 -- "Visa ending 4242", for the dashboard
  add column if not exists auto_topup_last_at timestamptz,       -- the last attempt (claimed before charging)
  add column if not exists auto_topup_error text;                -- why the last attempt failed; cleared by a new card

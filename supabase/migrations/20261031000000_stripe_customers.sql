-- Each agent's Stripe customer, saved from their first paid deposit. Later deposits reuse it, so Stripe
-- sees one customer with a growing payment history (which lowers false fraud blocks).
alter table public.agents add column stripe_customer_id text;

notify pgrst, 'reload schema';

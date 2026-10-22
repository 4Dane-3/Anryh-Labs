import "server-only";
import Stripe from "stripe";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { adSpendCents } from "@/lib/campaign";

// Stripe Checkout for "Add funds". A paid session becomes two wallet rows: the deposit and the
// Anryh Labs fee (20%), so the balance shows only what's left for ads. Stripe's own processing fee
// comes out of Anryh Labs' share, never the agent's ad money.
//
// Keys: live keys (sk_live_ / rk_live_) are only ever used on Vercel Production. Everywhere else
// (your machine, previews) uses the test key: STRIPE_TEST_SECRET_KEY if set, else STRIPE_SECRET_KEY if
// it's a test key. A live key outside Production is refused, so a local test can never charge a card.

const isProduction = () => process.env.VERCEL_ENV === "production";
const isLive = (key: string) => /^(sk|rk)_live_/.test(key);

export function stripeKey(): string | null {
  const main = process.env.STRIPE_SECRET_KEY?.trim() || "";
  const test = process.env.STRIPE_TEST_SECRET_KEY?.trim() || "";
  if (isProduction()) return main || null;
  if (test && !isLive(test)) return test;
  return main && !isLive(main) ? main : null;
}

export const stripeReady = () => !!stripeKey();
export const stripeTestMode = () => !!stripeKey() && !isLive(stripeKey()!);

let client: Stripe | null = null;
let clientKey = "";

export function stripe() {
  const key = stripeKey();
  if (!key) throw new Error("Stripe isn't set up here (live keys only run on Production; add STRIPE_TEST_SECRET_KEY for testing).");
  if (!client || clientKey !== key) {
    client = new Stripe(key);
    clientKey = key;
  }
  return client;
}

/** Where Stripe sends the agent back: always this deployment of our own app, never a URL from the browser. */
export function checkoutReturnBase() {
  if (isProduction() && process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, "");
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}

/** A Checkout page for a deposit. Returns the URL to send the agent to. */
export async function createDepositCheckout(input: { agentId: string; email: string; cents: number; appUrl: string }) {
  const forAds = adSpendCents(input.cents);
  const session = await stripe().checkout.sessions.create({
    mode: "payment",
    customer_email: input.email,
    client_reference_id: input.agentId,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: input.cents,
          product_data: {
            name: "Ad funds",
            description: `$${(forAds / 100).toFixed(2)} for your Meta ads, $${((input.cents - forAds) / 100).toFixed(2)} Anryh Labs fee (20%).`,
          },
        },
      },
    ],
    // The webhook trusts these (signed by Stripe), never the browser
    metadata: { agent_id: input.agentId, deposit_cents: String(input.cents), kind: "ad_funds" },
    payment_intent_data: { metadata: { agent_id: input.agentId, kind: "ad_funds" } },
    success_url: `${input.appUrl}/dashboard/funds?deposit=success`,
    cancel_url: `${input.appUrl}/dashboard/funds?deposit=canceled`,
  });
  if (!session.url) throw new Error("Stripe didn't return a checkout link.");
  return session.url;
}

/**
 * Records a paid deposit: +deposit and -fee, keyed by the Checkout session id so a webhook Stripe sends
 * twice (it retries) is only ever counted once. Returns false when it was already recorded.
 */
export async function recordDeposit(session: Stripe.Checkout.Session) {
  const agentId = session.metadata?.agent_id ?? session.client_reference_id;
  const cents = session.amount_total ?? Number(session.metadata?.deposit_cents);
  if (!agentId || !Number.isInteger(cents) || cents <= 0) throw new Error(`Checkout session ${session.id} has no agent or amount`);
  const fee = cents - adSpendCents(cents);
  const { error } = await supabaseAdmin.from("wallet_transactions").insert([
    { agent_id: agentId, kind: "deposit", amount_cents: cents, status: "completed", description: "Deposit (card)", external_id: session.id },
    { agent_id: agentId, kind: "fee", amount_cents: -fee, status: "completed", description: "Anryh Labs fee (20%)", external_id: `${session.id}:fee` },
  ]);
  if (error?.code === "23505") return false; // unique external_id: already recorded
  if (error) throw new Error(`Couldn't record the deposit: ${error.message}`);
  return true;
}

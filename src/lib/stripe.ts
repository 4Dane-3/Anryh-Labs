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
export async function createDepositCheckout(input: {
  agentId: string;
  email: string;
  cents: number;
  appUrl: string;
  customerId?: string | null; // the agent's Stripe customer from an earlier deposit
}) {
  const forAds = adSpendCents(input.cents);
  // One Stripe customer per agent: the first deposit creates it, later ones reuse it, so each paid
  // deposit builds the history Stripe's fraud checks look at
  const reuse = input.customerId
    ? { customer: input.customerId, customer_update: { address: "auto" as const, name: "auto" as const } }
    : null;
  const fresh = { customer_email: input.email, customer_creation: "always" as const };
  const create = (who: typeof reuse | typeof fresh) => stripe().checkout.sessions.create({
    mode: "payment",
    ...who,
    // More for Stripe to verify: the card's billing address (address and ZIP checks) and a phone number
    billing_address_collection: "required",
    phone_number_collection: { enabled: true },
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
  let session;
  try {
    session = await create(reuse ?? fresh);
  } catch (e) {
    // A saved customer that can't be used (deleted, or the API key can't read customers) must never
    // stop a deposit: fall back to a checkout that creates a new customer
    if (!reuse) throw e;
    console.error("stripe: couldn't reuse the saved customer, creating a new one", e instanceof Error ? e.message : e);
    session = await create(fresh);
  }
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
  // Remember the customer Checkout created, for this agent's next deposit (never overwrite an existing one)
  const customer = typeof session.customer === "string" ? session.customer : session.customer?.id;
  if (customer) {
    await supabaseAdmin.from("agents").update({ stripe_customer_id: customer }).eq("id", agentId).is("stripe_customer_id", null);
  }
  return true;
}

import "server-only";
import Stripe from "stripe";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { adSpendCents } from "@/lib/campaign";
import { referralRowFor, type WalletRow } from "@/lib/referrals";
import { reversalShares } from "@/lib/referrals-core";
import { alertAdmin } from "@/lib/migz/slack";

// Stripe Checkout for "Add funds". A paid session becomes two wallet rows: the deposit and the
// Anryh Labs fee (20%), so the balance shows only what's left for ads. Stripe's own processing fee
// comes out of Anryh Labs' share, never the agent's ad money. When the agent was referred, a third
// row credits their referrer 1% (also out of Anryh Labs' share). A refund or chargeback reverses its
// share of all three.
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
 * Records a paid deposit: +deposit and -fee (and +1% to the referrer, if any), in one insert keyed by
 * the Checkout session id, so a webhook Stripe sends twice (it retries) is only ever counted once and
 * the credit can't be given without the deposit. Returns false when it was already recorded.
 */
export async function recordDeposit(session: Stripe.Checkout.Session) {
  const agentId = session.metadata?.agent_id ?? session.client_reference_id;
  const cents = session.amount_total ?? Number(session.metadata?.deposit_cents);
  if (!agentId || !Number.isInteger(cents) || cents <= 0) throw new Error(`Checkout session ${session.id} has no agent or amount`);
  const fee = cents - adSpendCents(cents);
  const customer = typeof session.customer === "string" ? session.customer : session.customer?.id;
  const rows: WalletRow[] = [
    { agent_id: agentId, kind: "deposit", amount_cents: cents, status: "completed", description: "Deposit (card)", external_id: session.id },
    { agent_id: agentId, kind: "fee", amount_cents: -fee, status: "completed", description: "Anryh Labs fee (20%)", external_id: `${session.id}:fee` },
  ];
  const referral = await referralRowFor({ agentId, depositCents: cents, sessionId: session.id, customerId: customer ?? null });
  let { error } = await supabaseAdmin.from("wallet_transactions").insert(referral ? [...rows, referral] : rows);
  if (error && error.code !== "23505" && referral) {
    // The credit must never cost the agent their deposit: record the deposit alone and tell staff
    console.error("referral credit row failed, recording the deposit without it", error.message);
    ({ error } = await supabaseAdmin.from("wallet_transactions").insert(rows));
    if (!error) await alertAdmin(`A ${usd(cents)} deposit was recorded but its ${usd(referral.amount_cents)} referral credit failed (session ${session.id}). Add it by hand.`);
  }
  if (error?.code === "23505") return false; // unique external_id: already recorded
  if (error) throw new Error(`Couldn't record the deposit: ${error.message}`);
  // Remember the customer Checkout created, for this agent's next deposit (never overwrite an existing one)
  if (customer) {
    await supabaseAdmin.from("agents").update({ stripe_customer_id: customer }).eq("id", agentId).is("stripe_customer_id", null);
  }
  return true;
}

const usd = (c: number) => `$${(c / 100).toFixed(2)}`;

export type Reversal = "refund" | "chargeback" | "chargeback_won";

/**
 * Takes back `amountCents` of a recorded deposit (a refund or a chargeback), or gives it back when a
 * chargeback is won. The agent loses the ad money only (the matching fee share is returned), and the
 * referrer loses the matching share of their credit. Keyed by the refund or dispute id, so a repeated
 * webhook counts once. Returns what moved, or null when there was nothing to do.
 */
export async function recordReversal(input: { sessionId: string; key: string; amountCents: number; reason: Reversal }) {
  const { data: rows } = await supabaseAdmin
    .from("wallet_transactions")
    .select("agent_id, kind, amount_cents, external_id, related_agent_id")
    .in("external_id", [input.sessionId, `${input.sessionId}:fee`, `${input.sessionId}:referral`]);
  const deposit = rows?.find((r) => r.external_id === input.sessionId && r.kind === "deposit");
  if (!deposit) return null; // not a deposit we recorded
  const fee = rows?.find((r) => r.external_id === `${input.sessionId}:fee`);
  const credit = rows?.find((r) => r.external_id === `${input.sessionId}:referral`);
  const share = reversalShares({ depositCents: deposit.amount_cents, feeCents: fee?.amount_cents ?? 0, creditCents: credit?.amount_cents ?? 0, amountCents: input.amountCents });
  if (!share.refundCents) return null;

  const back = input.reason === "chargeback_won" ? -1 : 1; // a won chargeback puts everything back
  const what = { refund: "Refund", chargeback: "Chargeback", chargeback_won: "Chargeback won" }[input.reason];
  const out: WalletRow[] = [
    {
      agent_id: deposit.agent_id,
      kind: input.reason === "chargeback_won" ? "adjustment" : "refund",
      amount_cents: -back * share.refundCents,
      status: "completed",
      description: input.reason === "chargeback_won" ? `Chargeback won: ${usd(share.refundCents)} deposit restored` : `${what}: ${usd(share.refundCents)} of a deposit returned to your card`,
      external_id: input.key,
    },
  ];
  if (share.feeBackCents)
    out.push({
      agent_id: deposit.agent_id,
      kind: "fee",
      amount_cents: back * share.feeBackCents,
      status: "completed",
      description: input.reason === "chargeback_won" ? "Anryh Labs fee (20%) on the restored deposit" : `Anryh Labs fee (20%) returned with the ${what.toLowerCase()}`,
      external_id: `${input.key}:fee`,
    });
  if (credit && share.creditBackCents)
    out.push({
      agent_id: credit.agent_id,
      kind: "referral_credit",
      amount_cents: -back * share.creditBackCents,
      status: "completed",
      description: input.reason === "chargeback_won" ? "Referral credit restored (chargeback won)" : `Referral credit reversed: the deposit was ${input.reason === "refund" ? "refunded" : "charged back"}`,
      external_id: `${input.key}:referral`,
      ...(credit.related_agent_id ? { related_agent_id: credit.related_agent_id } : {}),
    });
  const { error } = await supabaseAdmin.from("wallet_transactions").insert(out);
  if (error?.code === "23505") return null; // already recorded
  if (error) throw new Error(`Couldn't record the ${what.toLowerCase()}: ${error.message}`);
  return { agentId: deposit.agent_id, referrerId: credit?.agent_id ?? null, ...share };
}

/** The ad-funds Checkout session behind a charge, or null when the charge isn't a deposit. */
async function sessionForCharge(charge: Stripe.Charge) {
  const pi = typeof charge.payment_intent === "string" ? charge.payment_intent : charge.payment_intent?.id;
  if (!pi) return null;
  const { data } = await stripe().checkout.sessions.list({ payment_intent: pi, limit: 1 });
  const session = data[0];
  return session?.metadata?.kind === "ad_funds" ? session : null;
}

/** For charge.refunded / charge.refund.updated: records every succeeded refund on a deposit charge (each once). */
export async function reconcileRefunds(charge: Stripe.Charge) {
  const session = await sessionForCharge(charge);
  if (!session) return 0;
  const refunds = await stripe().refunds.list({ charge: charge.id, limit: 100 });
  let recorded = 0;
  for (const r of refunds.data) {
    if (r.status !== "succeeded") continue;
    if (await recordReversal({ sessionId: session.id, key: r.id, amountCents: r.amount, reason: "refund" })) recorded++;
  }
  return recorded;
}

/** For charge.dispute.created (money taken back now) and charge.dispute.closed (given back if won). */
export async function recordDispute(dispute: Stripe.Dispute, closed: boolean) {
  if (closed && dispute.status !== "won") return null; // lost: the money already came out when it opened
  const chargeId = typeof dispute.charge === "string" ? dispute.charge : dispute.charge.id;
  const charge = await stripe().charges.retrieve(chargeId);
  const session = await sessionForCharge(charge);
  if (!session) return null;
  const moved = await recordReversal({
    sessionId: session.id,
    key: closed ? `${dispute.id}:won` : dispute.id,
    amountCents: dispute.amount,
    reason: closed ? "chargeback_won" : "chargeback",
  });
  if (moved && !closed) {
    const { data: a } = await supabaseAdmin.from("agents").select("full_name").eq("id", moved.agentId).maybeSingle();
    await alertAdmin(
      `Chargeback on ${a?.full_name ?? "an agent"}'s deposit: ${usd(moved.refundCents)} disputed, ${usd(moved.adMoneyCents)} taken back from their ad funds${moved.creditBackCents ? `, ${usd(moved.creditBackCents)} referral credit reversed` : ""}. Respond to it in Stripe.`,
    );
  }
  return moved;
}

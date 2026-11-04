import type Stripe from "stripe";
import { reconcileRefunds, recordAutoTopUp, recordAutoTopUpFailure, recordAutoTopUpSetup, recordDeposit, recordDispute, recordSetupFee, stripe } from "@/lib/stripe";

// Stripe calls this when a Checkout payment completes. The signature is checked against
// STRIPE_WEBHOOK_SECRET (each endpoint, test or live, has its own), so nobody else can add funds.
export async function POST(req: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  const signature = req.headers.get("stripe-signature");
  if (!secret || !signature) return Response.json({ error: "Missing signature" }, { status: 400 });

  let event: Stripe.Event;
  try {
    // The raw body, exactly as sent: re-serialized JSON would fail the signature check
    event = stripe().webhooks.constructEvent(await req.text(), signature, secret);
  } catch (e) {
    console.error("stripe webhook rejected", e instanceof Error ? e.message : e);
    return Response.json({ error: "Bad signature" }, { status: 400 });
  }

  // Card payments arrive paid on completion; slower methods (bank debits) finish later
  if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
    const session = event.data.object as Stripe.Checkout.Session;
    const kind = session.metadata?.kind;
    // A card saved for auto top-up: nothing was charged
    if (kind === "auto_topup_setup") {
      try {
        return Response.json({ ok: true, recorded: await recordAutoTopUpSetup(session) });
      } catch (e) {
        console.error("stripe auto top-up setup failed", e);
        return Response.json({ error: "Couldn't save the card" }, { status: 500 });
      }
    }
    if (kind !== "ad_funds" && kind !== "setup_fee") return Response.json({ ok: true, ignored: "not ours" });
    if (session.payment_status !== "paid") return Response.json({ ok: true, pending: true });
    try {
      const recorded = kind === "setup_fee" ? await recordSetupFee(session) : await recordDeposit(session);
      return Response.json({ ok: true, recorded });
    } catch (e) {
      console.error(`stripe ${kind} failed`, e);
      // 500 makes Stripe retry later, which is what we want if the database hiccuped
      return Response.json({ error: "Couldn't record the payment" }, { status: 500 });
    }
  }

  // An auto top-up charged off-session: recorded when it succeeds (usually already, by the charger itself)
  if (event.type === "payment_intent.succeeded" || event.type === "payment_intent.payment_failed") {
    const pi = event.data.object as Stripe.PaymentIntent;
    if (pi.metadata?.kind !== "ad_funds" || pi.metadata?.auto !== "1") return Response.json({ ok: true, ignored: "not an auto top-up" });
    try {
      if (event.type === "payment_intent.succeeded") return Response.json({ ok: true, recorded: await recordAutoTopUp(pi) });
      await recordAutoTopUpFailure(pi);
      return Response.json({ ok: true });
    } catch (e) {
      console.error(`stripe ${event.type} failed`, e);
      return Response.json({ error: "Couldn't record the top-up" }, { status: 500 });
    }
  }

  // Money going back: a refund, or a chargeback (and the chargeback's result). Each takes back its share
  // of the deposit, the fee and any referral credit; repeats are counted once.
  try {
    if (event.type === "charge.refunded" || event.type === "charge.refund.updated") {
      const obj = event.data.object as Stripe.Charge | Stripe.Refund;
      const chargeId = obj.object === "charge" ? null : typeof obj.charge === "string" ? obj.charge : obj.charge?.id;
      if (obj.object !== "charge" && !chargeId) return Response.json({ ok: true, ignored: "refund without a charge" });
      const charge = obj.object === "charge" ? obj : await stripe().charges.retrieve(chargeId!);
      return Response.json({ ok: true, recorded: await reconcileRefunds(charge) });
    }
    if (event.type === "charge.dispute.created" || event.type === "charge.dispute.closed") {
      const moved = await recordDispute(event.data.object as Stripe.Dispute, event.type === "charge.dispute.closed");
      return Response.json({ ok: true, recorded: !!moved });
    }
  } catch (e) {
    console.error(`stripe ${event.type} failed`, e);
    return Response.json({ error: "Couldn't record that" }, { status: 500 });
  }
  return Response.json({ ok: true });
}

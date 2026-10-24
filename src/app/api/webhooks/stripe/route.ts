import type Stripe from "stripe";
import { reconcileRefunds, recordDeposit, recordDispute, stripe } from "@/lib/stripe";

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
    if (session.metadata?.kind !== "ad_funds") return Response.json({ ok: true, ignored: "not ad funds" });
    if (session.payment_status !== "paid") return Response.json({ ok: true, pending: true });
    try {
      const recorded = await recordDeposit(session);
      return Response.json({ ok: true, recorded });
    } catch (e) {
      console.error("stripe deposit failed", e);
      // 500 makes Stripe retry later, which is what we want if the database hiccuped
      return Response.json({ error: "Couldn't record the deposit" }, { status: 500 });
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

import "server-only";
import type Stripe from "stripe";
import { supabaseAdmin } from "@/lib/supabase-admin";
import type { Agent } from "@/lib/booking/data";
import { feeCents } from "@/lib/campaign";
import { COOLDOWN_HOURS, topUpDue } from "@/lib/auto-top-up";
import { getBalanceCents, getFundsAddedCents } from "@/lib/dashboard/queries";
import { recordAutoTopUp, stripe, stripeReady } from "@/lib/stripe";
import { alertAdmin } from "@/lib/migz/slack";
import { sendSlackMessage } from "@/lib/slack";

// Charges an agent's saved card when their free ad balance is below the level they chose (auto-top-up.ts has
// the rules). Called from the hourly run and right before a weekly cycle would wait for funds. The attempt is
// claimed on the agent row first (one per COOLDOWN_HOURS), and Stripe gets an idempotency key per claim, so
// overlapping runs or a retry can never charge twice. A declined card stops auto top-up until a card is saved
// again, and both the agent and staff hear about it.

const usd = (c: number) => `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: c % 100 ? 2 : 0 })}`;

async function tellAgent(agent: Agent, text: string) {
  if (!agent.slack_user_id || !process.env.SLACK_BOT_TOKEN) return;
  await sendSlackMessage(agent.slack_user_id, text).catch((e) => console.error("top-up slack note failed", e instanceof Error ? e.message : e));
}

export type TopUpResult = { charged: true; cents: number } | { charged: false; why: string };

export async function autoTopUp(agent: Agent, now = new Date()): Promise<TopUpResult> {
  if (!stripeReady()) return { charged: false, why: "stripe_off" };
  const balance = await getBalanceCents(agent.id);
  const due = topUpDue(
    {
      on: !!agent.auto_topup,
      hasCard: !!agent.stripe_payment_method_id && !!agent.stripe_customer_id,
      error: agent.auto_topup_error ?? null,
      freeBalanceCents: balance,
      belowCents: agent.auto_topup_below_cents ?? null,
      amountCents: agent.auto_topup_amount_cents ?? null,
      lastAt: agent.auto_topup_last_at ?? null,
    },
    now,
  );
  if (!due.due) return { charged: false, why: due.why };

  // Claim the attempt: only one run gets past this per cooldown window
  const claimAt = now.toISOString();
  const cutoff = new Date(now.getTime() - COOLDOWN_HOURS * 3_600_000).toISOString();
  const { data: claimed } = await supabaseAdmin
    .from("agents")
    .update({ auto_topup_last_at: claimAt })
    .eq("id", agent.id)
    .eq("auto_topup", true)
    .or(`auto_topup_last_at.is.null,auto_topup_last_at.lt.${cutoff}`)
    .select("id");
  if (!claimed?.length) return { charged: false, why: "cooldown" };

  const cents = agent.auto_topup_amount_cents!;
  const addedBefore = await getFundsAddedCents(agent.id);
  const fee = feeCents(cents, addedBefore);
  let pi: Stripe.PaymentIntent;
  try {
    pi = await stripe().paymentIntents.create(
      {
        amount: cents,
        currency: "usd",
        customer: agent.stripe_customer_id!,
        payment_method: agent.stripe_payment_method_id!,
        off_session: true,
        confirm: true,
        description: `Anryh Labs auto top-up: ${usd(cents - fee)} for Meta ads, ${usd(fee)} fee`,
        metadata: { agent_id: agent.id, kind: "ad_funds", auto: "1", deposit_cents: String(cents), fee_cents: String(fee), added_before_cents: String(addedBefore) },
      },
      { idempotencyKey: `auto-topup/${agent.id}/${claimAt}` },
    );
  } catch (e) {
    const err = e as { type?: string; message?: string; code?: string; raw?: { message?: string } };
    if (err.type !== "StripeCardError" && err.code !== "authentication_required") {
      // Not the card (Stripe unreachable, a hiccup): give the claim back so the next hourly run tries again
      await supabaseAdmin.from("agents").update({ auto_topup_last_at: agent.auto_topup_last_at ?? null }).eq("id", agent.id).eq("auto_topup_last_at", claimAt);
      console.error("auto top-up: Stripe error", agent.slug, err.message);
      return { charged: false, why: "error" };
    }
    const reason = err.code === "authentication_required" ? "Your bank asked to confirm this charge, which can't happen automatically." : (err.raw?.message ?? err.message ?? "The card was declined.");
    await supabaseAdmin.from("agents").update({ auto_topup_error: reason.slice(0, 300) }).eq("id", agent.id);
    await tellAgent(agent, `:warning: Your auto top-up of ${usd(cents)} didn't go through: ${reason} Auto top-up is paused until you save a card again on the Ad funds page.`);
    await alertAdmin(`Auto top-up failed for ${agent.full_name} (${agent.slug}), ${usd(cents)}: ${reason}`);
    return { charged: false, why: "declined" };
  }

  if (pi.status === "succeeded") {
    await recordAutoTopUp(pi);
    await tellAgent(agent, `:white_check_mark: Auto top-up: charged ${usd(cents)} to your ${agent.auto_topup_card ?? "saved card"}. ${usd(cents - fee)} went to your ad balance (the rest is the Anryh Labs fee), so your campaign keeps rolling.`);
    return { charged: true, cents };
  }
  // A slower method (a bank debit) finishes later; the webhook records it when it succeeds
  return { charged: false, why: `pending_${pi.status}` };
}

/** The hourly run: every agent with auto top-up on. Returns slug → what happened, for the cron's log. */
export async function autoTopUpAll(deadlineMs: number) {
  const { data } = await supabaseAdmin.from("agents").select("*").eq("active", true).eq("auto_topup", true).is("auto_topup_error", null);
  const out: Record<string, string> = {};
  for (const agent of (data ?? []) as Agent[]) {
    if (Date.now() > deadlineMs) break;
    const res = await autoTopUp(agent).catch((e) => {
      console.error("auto top-up crashed", agent.slug, e);
      return { charged: false as const, why: "error" };
    });
    if (res.charged || res.why === "declined") out[agent.slug] = res.charged ? `topped up ${usd(res.cents)}` : "declined";
  }
  return out;
}

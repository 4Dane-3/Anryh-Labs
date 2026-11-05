import "server-only";
import { supabaseAdmin } from "@/lib/supabase-admin";
import type { Agent } from "@/lib/booking/data";
import { cleanFocus } from "@/lib/migz/topics";
import { getBalanceCents } from "@/lib/dashboard/queries";
import { depositFor, MIN_AD_BALANCE_CENTS, MIN_DEPOSIT_CENTS, SETUP_FEE_CENTS } from "@/lib/campaign";
import { campaignMoney, roundUpToFundsStep } from "@/lib/campaign-plan";
import { DEFAULT_INTENT, DEFAULT_VIDEO_TIER, isIntentLevel, isVideoTier } from "@/lib/ad-options";
import { getOpenBatch, getRecentBatches, type Batch } from "@/lib/dashboard/batches";

// What "Start here" checks. Each step is done or not, with the reason it isn't, so the page and the
// launch action agree. Only what's needed to run a first campaign: their business details and Meta ad
// account first, the setup fee, then the rest. Until the first campaign starts, the rest of the dashboard
// stays locked (requireSetUpAgent).

export type StepKey = "business" | "meta" | "setup_fee" | "profile" | "page" | "slack" | "funds" | "plan" | "creatives" | "mode";

export type Step = {
  key: StepKey;
  done: boolean;
  required: boolean;
  /** What's missing, in the agent's words. */
  missing: string | null;
};

export type SetupState = {
  steps: Step[];
  balanceCents: number;
  creativeCount: number;
  /** Whether they've set the hours they take calls (their page here can't book without them). */
  hasHours: boolean;
  /** The batch planned in setup (or running), shown on the plan step. */
  batch: Batch | null;
  /** What the planned campaign needs in ad funds (ad spend plus paid videos), and that rounded up to the next $500. */
  fundsNeeded: { cents: number; recommendedCents: number } | null;
  canLaunch: boolean;
  completed: boolean;
};

export async function getSetupState(agent: Agent): Promise<SetupState> {
  const [balanceCents, hours, creatives, openBatch, pastBatches] = await Promise.all([
    getBalanceCents(agent.id),
    supabaseAdmin.from("availability_rules").select("id", { count: "exact", head: true }).eq("agent_id", agent.id),
    supabaseAdmin.from("creatives").select("id", { count: "exact", head: true }).eq("agent_id", agent.id).in("status", ["submitted", "in_review", "live"]).eq("source", "upload"),
    getOpenBatch(agent.id),
    getRecentBatches(agent.id, 1),
  ]);
  const batch = openBatch ?? pastBatches[0] ?? null;
  const creativeCount = creatives.count ?? 0;

  const profileMissing = !agent.full_name || agent.full_name.trim().length < 2
    ? "Add your name."
    : !agent.licensed_states.length
      ? "Choose the states you're licensed in."
      : !agent.bio
        ? "Write a short bio so people know who they're booking with."
        : null;
  const businessMissing = !agent.agency_name
    ? "Tell us the agency or IMO you write through."
    : !agent.call_phone
      ? "Add the phone number leads should reach you on."
      : null;
  const metaMissing = agent.meta_ad_account_id && agent.meta_page_id
    ? null
    : agent.meta_access_requested_at
      ? "Waiting for Anryh Labs to accept your ad account and Page. Check again once we've confirmed it."
      : "Share your Meta ad account and Facebook Page with Anryh Labs.";
  // Their page here needs hours to book; their own booking page needs its link
  const pageMissing = !agent.booking_choice
    ? "Choose where your ads send people."
    : agent.booking_choice === "own"
      ? agent.own_booking_url ? null : "Add the link to your booking page."
      : (hours.count ?? 0) === 0 ? "Set the hours you take calls." : null;
  const slackMissing = agent.slack_user_id ? null : "Connect Slack so Migz can tell you about new leads.";
  // The planned campaign sets what the funds step needs: two weeks of its ad spend plus any paid videos
  const planned = batch && batch.status !== "ended" && batch.status !== "canceled" ? batch : null;
  const neededCents = planned
    ? campaignMoney({
        dailyCents: planned.daily_cents,
        intent: isIntentLevel(agent.intent_level) ? agent.intent_level : DEFAULT_INTENT,
        tier: isVideoTier(agent.video_tier) ? agent.video_tier : DEFAULT_VIDEO_TIER,
      }).neededCents
    : null;
  const fundsNeeded = neededCents ? { cents: neededCents, recommendedCents: roundUpToFundsStep(neededCents) } : null;
  const money = (c: number) => `$${(c / 100).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  const fundsMissing = fundsNeeded
    ? balanceCents < fundsNeeded.cents
      ? `Your campaign needs ${money(fundsNeeded.cents)} in ad funds (we recommend ${money(fundsNeeded.recommendedCents)}). Add about ${money(roundUpToFundsStep(depositFor(fundsNeeded.recommendedCents - balanceCents)))} with the 20% fee.`
      : null
    : balanceCents < MIN_AD_BALANCE_CENTS
      ? `Add at least $${(MIN_DEPOSIT_CENTS / 100).toLocaleString("en-US")} (two weeks at $50/day). Plan your campaign first to see what it needs.`
      : null;
  // Agents who finished setup before the setup fee existed count as paid
  const setupFeeMissing = agent.setup_fee_paid_at || agent.onboarding_completed_at ? null : `Pay the one-time $${(SETUP_FEE_CENTS / 100).toLocaleString("en-US")} setup fee.`;
  const planMissing = !cleanFocus(agent.ad_focus).length || !batch ? "Answer a few quick questions and pick a daily budget." : null;
  const mode = agent.creative_mode ?? null;
  const creativesMissing = !mode
    ? "Choose how you want your ads' videos and images made."
    : mode === "upload" && creativeCount === 0
      ? "Upload at least one photo or video, or let Migz create them."
      : null;

  const modeMissing = agent.migz_mode_chosen_at ? null : "Choose whether Migz runs your ads on its own or asks you first.";

  const steps: Step[] = [
    { key: "business", required: true, missing: businessMissing, done: !businessMissing },
    { key: "meta", required: true, missing: metaMissing, done: !metaMissing },
    { key: "setup_fee", required: true, missing: setupFeeMissing, done: !setupFeeMissing },
    { key: "profile", required: true, missing: profileMissing, done: !profileMissing },
    { key: "page", required: true, missing: pageMissing, done: !pageMissing },
    { key: "slack", required: true, missing: slackMissing, done: !slackMissing },
    { key: "plan", required: true, missing: planMissing, done: !planMissing },
    { key: "funds", required: true, missing: fundsMissing, done: !fundsMissing },
    { key: "creatives", required: true, missing: creativesMissing, done: !creativesMissing },
    { key: "mode", required: true, missing: modeMissing, done: !modeMissing },
  ];
  return {
    steps,
    balanceCents,
    creativeCount,
    hasHours: (hours.count ?? 0) > 0,
    batch,
    fundsNeeded,
    canLaunch: steps.every((s) => s.done || !s.required),
    completed: !!agent.onboarding_completed_at,
  };
}

/** Messages for every required step that isn't done yet. Empty = ready to start. */
export async function setupBlockers(agent: Agent) {
  const state = await getSetupState(agent);
  return state.steps.filter((s) => s.required && !s.done).map((s) => s.missing ?? "Finish setup first.");
}

import "server-only";
import { isRoofer } from "@/lib/verticals";
import { supabaseAdmin } from "@/lib/supabase-admin";
import type { Agent } from "@/lib/booking/data";
import { cleanFocus } from "@/lib/migz/topics";
import { getBalanceCents } from "@/lib/dashboard/queries";
import { depositFor, feePlanOf, MIGZ_MONTHLY_CENTS, MIN_AD_BALANCE_CENTS, MIN_DEPOSIT_CENTS, SETUP_FEE_CENTS } from "@/lib/campaign";
import { campaignMoney, roundUpToFundsStep } from "@/lib/campaign-plan";
import { DEFAULT_INTENT, DEFAULT_VIDEO_TIER, isIntentLevel, isVideoTier } from "@/lib/ad-options";
import { getOpenBatch, getRecentBatches, type Batch } from "@/lib/dashboard/batches";

// What "Start here" checks. Each step is done or not, with the reason it isn't, so the page and the
// launch action agree. Only what's needed to run a first campaign: their business details and Meta ad
// account first, the setup fee, then the rest. Until the first campaign starts, the rest of the dashboard
// stays locked (requireSetUpAgent).

export type StepKey = "vertical" | "business" | "meta" | "setup_fee" | "profile" | "page" | "crm" | "slack" | "funds" | "plan" | "rules" | "details" | "avatar" | "media" | "creatives" | "mode";

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
  const [balanceCents, hours, creatives, openBatch, pastBatches, brandRow, presenterRow] = await Promise.all([
    getBalanceCents(agent.id),
    supabaseAdmin.from("availability_rules").select("id", { count: "exact", head: true }).eq("agent_id", agent.id),
    supabaseAdmin.from("creatives").select("id", { count: "exact", head: true }).eq("agent_id", agent.id).in("status", ["submitted", "in_review", "live"]).eq("source", "upload"),
    getOpenBatch(agent.id),
    getRecentBatches(agent.id, 1),
    isRoofer(agent) ? supabaseAdmin.from("agent_brand").select("deals, certifications, warranties").eq("agent_id", agent.id).maybeSingle() : null,
    isRoofer(agent) ? supabaseAdmin.from("agent_presenters").select("*").eq("agent_id", agent.id).maybeSingle() : null,
  ]);
  const batch = openBatch ?? pastBatches[0] ?? null;
  const creativeCount = creatives.count ?? 0;

  const roof = isRoofer(agent);
  const profileMissing = !agent.full_name || agent.full_name.trim().length < 2
    ? roof ? "Add your company name." : "Add your name."
    : roof
      ? !agent.bio ? "Write a short intro so homeowners know who's coming." : null
    : !agent.licensed_states.length
      ? "Choose the states you're licensed in."
      : !agent.bio
        ? "Write a short bio so people know who they're booking with."
        : null;
  const businessMissing = !agent.agency_name && !roof
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
      : (hours.count ?? 0) === 0 ? (roof ? "Set the hours your crews inspect." : "Set the hours you take calls.") : null;
  const slackMissing = agent.slack_user_id ? null : "Connect Slack so Migz can tell you about new leads.";
  // The planned campaign sets what the funds step needs: two weeks of its ad spend plus any paid videos
  const planned = batch && batch.status !== "ended" && batch.status !== "canceled" ? batch : null;
  const neededCents = planned
    ? campaignMoney({
        dailyCents: planned.daily_cents,
        intent: isIntentLevel(agent.intent_level) ? agent.intent_level : DEFAULT_INTENT,
        tier: isVideoTier(agent.video_tier) ? agent.video_tier : DEFAULT_VIDEO_TIER,
        vertical: roof ? "roofing" : "insurance",
      }).neededCents
    : null;
  const fundsNeeded = neededCents ? { cents: neededCents, recommendedCents: roundUpToFundsStep(neededCents) } : null;
  // New roofers are on Migz AI by the month, so their ad funds carry no fee
  const plan = feePlanOf(agent) === "subscription" || (roof && !agent.onboarding_completed_at) ? "subscription" : "percent";
  const money = (c: number) => `$${(c / 100).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  const fundsMissing = fundsNeeded
    ? balanceCents < fundsNeeded.cents
      ? `Your campaign needs ${money(fundsNeeded.cents)} in ad funds (we recommend ${money(fundsNeeded.recommendedCents)}). Add about ${money(roundUpToFundsStep(depositFor(fundsNeeded.recommendedCents - balanceCents, 0, plan)))}${plan === "subscription" ? "; all of it goes to your ads" : " with the 20% fee"}.`
      : null
    : balanceCents < MIN_AD_BALANCE_CENTS
      ? `Add at least $${(MIN_DEPOSIT_CENTS / 100).toLocaleString("en-US")} (two weeks at $50/day). Plan your campaign first to see what it needs.`
      : null;
  // Agents who finished setup before the setup fee existed count as paid
  // Roofers start Migz AI by the month instead (no setup fee); the same step tracks it
  const setupFeeMissing = agent.setup_fee_paid_at || agent.onboarding_completed_at
    ? null
    : roof
      ? `Start Migz AI: $${(MIGZ_MONTHLY_CENTS / 100).toLocaleString("en-US")} a month, no setup fee.`
      : `Pay the one-time $${(SETUP_FEE_CENTS / 100).toLocaleString("en-US")} setup fee.`;
  const planMissing = !cleanFocus(agent.ad_focus).length || !batch ? "Answer a few quick questions and pick a daily budget." : roof && !agent.service_area ? "Add where your crews work (your service area)." : null;
  const mode = agent.creative_mode ?? null;
  const creativesMissing = !mode
    ? "Choose how you want your ads' videos and images made."
    : mode === "upload" && creativeCount === 0
      ? "Upload at least one photo or video, or let Migz create them."
      : null;

  // Setup's first question, answered once (accounts that finished setup before it existed count as answered)
  const verticalMissing = agent.vertical_chosen_at || agent.onboarding_completed_at ? null : "Tell us whether you're a roofing company or an insurance agent.";
  // Roofers book in their own CRM's calendar, so they're asked which CRM instead of setting up a booking page
  const crmMissing = agent.crm ? null : "Tell us which CRM you book inspections in.";
  const rules = agent.job_rules as { jobTypes?: string[] } | null;
  const rulesMissing = !agent.lead_goal
    ? "Choose what your ads offer: a free roof inspection or a free quote."
    : !rules
      ? "Choose the jobs you take."
      : !rules.jobTypes?.length ? "Pick at least one kind of job you take." : null;
  // The business details every video can feature: their current special and their warranty (certifications if they hold any)
  const brand = brandRow?.data as { deals?: string[]; certifications?: string[]; warranties?: string[] } | null | undefined;
  const detailsMissing = !brand?.deals?.filter(Boolean).length
    ? "Add the special you want this campaign to promote."
    : !brand.warranties?.filter(Boolean).length ? "Add the warranty you offer." : null;
  const presenter = presenterRow?.data as { mode?: string; photo_paths?: string[]; film_path?: string | null; consent_at?: string | null; job_media?: unknown[]; job_photo_paths?: string[] } | null | undefined;
  const mediaMissing = (presenter?.job_media?.length ?? 0) + (presenter?.job_photo_paths?.length ?? 0) || (presenter as { voice_sample_path?: string | null; ad_voice_id?: string | null } | null | undefined)?.voice_sample_path || (presenter as { ad_voice_id?: string | null } | null | undefined)?.ad_voice_id ? null : "Pick the voice for your ads and add photos or clips of your real jobs.";
  const avatarMissing = !presenter
    ? "Choose who appears in your on-camera ads, or skip them."
    : presenter.mode === "ai" && (!presenter.photo_paths?.length || !presenter.consent_at)
      ? "Add their photo and agree to it being used."
      : null;

  const modeMissing = agent.migz_mode_chosen_at ? null : "Choose whether Migz runs your ads on its own or asks you first.";

  const step = (key: StepKey, missing: string | null, required = true): Step => ({ key, required, missing, done: !missing });
  const steps: Step[] = [
    step("vertical", verticalMissing),
    step("business", businessMissing),
    step("meta", metaMissing),
    step("setup_fee", setupFeeMissing),
    step("profile", profileMissing),
    ...(roof
      ? [
          step("crm", crmMissing),
          step("rules", rulesMissing), // the jobs they take and the lead goal
          step("details", detailsMissing), // special, certifications, warranties, license
          step("media", mediaMissing, false), // Ad Creative AI Context: their voice, job photos and clips (optional)
          step("avatar", avatarMissing, false), // who's on camera: optional, never blocks starting
          step("slack", slackMissing, false), // roofers hear about inspections by email
        ]
      : [step("page", pageMissing), step("slack", slackMissing)]),
    step("plan", planMissing),
    step("funds", fundsMissing),
    step("creatives", creativesMissing),
    step("mode", modeMissing),
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

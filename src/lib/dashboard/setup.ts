import "server-only";
import { supabaseAdmin } from "@/lib/supabase-admin";
import type { Agent } from "@/lib/booking/data";
import { cleanFocus } from "@/lib/migz/topics";
import { getBalanceCents } from "@/lib/dashboard/queries";
import { MIN_AD_BALANCE_CENTS, MIN_DEPOSIT_CENTS } from "@/lib/campaign";

// What "Start here" checks. Each step is done or not, with the reason it isn't, so the page and the
// launch action agree. Only what's needed to run a first campaign.

export type StepKey = "profile" | "page" | "funds" | "plan" | "creatives";

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
  canLaunch: boolean;
  completed: boolean;
};

export async function getSetupState(agent: Agent): Promise<SetupState> {
  const [balanceCents, hours, creatives] = await Promise.all([
    getBalanceCents(agent.id),
    supabaseAdmin.from("availability_rules").select("id", { count: "exact", head: true }).eq("agent_id", agent.id),
    supabaseAdmin.from("creatives").select("id", { count: "exact", head: true }).eq("agent_id", agent.id).in("status", ["submitted", "in_review", "live"]).eq("source", "upload"),
  ]);
  const creativeCount = creatives.count ?? 0;

  const profileMissing = !agent.full_name || agent.full_name.trim().length < 2
    ? "Add your name."
    : !agent.licensed_states.length
      ? "Choose the states you're licensed in."
      : !agent.bio
        ? "Write a short bio so people know who they're booking with."
        : null;
  const pageMissing = (hours.count ?? 0) === 0 ? "Set the hours you take calls." : null;
  const fundsMissing =
    balanceCents < MIN_AD_BALANCE_CENTS
      ? `Add at least $${MIN_DEPOSIT_CENTS / 100}. After the 20% fee that's $${MIN_AD_BALANCE_CENTS / 100} of ads: 2 campaigns at $10/day for 2 weeks.`
      : null;
  const planMissing = !cleanFocus(agent.ad_focus).length
    ? "Choose what you want to promote."
    : agent.campaign_days === null || agent.campaign_days === undefined
      ? "Choose how long the campaign should run."
      : null;
  const mode = agent.creative_mode ?? null;
  const creativesMissing = !mode
    ? "Choose how you want your ads' videos and images made."
    : mode === "upload" && creativeCount === 0
      ? "Upload at least one photo or video, or let Migz create them."
      : null;

  const steps: Step[] = [
    { key: "profile", required: true, missing: profileMissing, done: !profileMissing },
    { key: "page", required: true, missing: pageMissing, done: !pageMissing },
    { key: "funds", required: true, missing: fundsMissing, done: !fundsMissing },
    { key: "plan", required: true, missing: planMissing, done: !planMissing },
    { key: "creatives", required: true, missing: creativesMissing, done: !creativesMissing },
  ];
  return {
    steps,
    balanceCents,
    creativeCount,
    canLaunch: steps.every((s) => s.done || !s.required),
    completed: !!agent.onboarding_completed_at,
  };
}

/** Messages for every required step that isn't done yet. Empty = ready to start. */
export async function setupBlockers(agent: Agent) {
  const state = await getSetupState(agent);
  return state.steps.filter((s) => s.required && !s.done).map((s) => s.missing ?? "Finish setup first.");
}

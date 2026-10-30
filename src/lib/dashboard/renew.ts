import "server-only";
import { supabaseAdmin } from "@/lib/supabase-admin";
import type { Agent } from "@/lib/booking/data";
import { migzReadyFor } from "@/lib/integrations";
import { cleanFocus } from "@/lib/migz/topics";
import { notifyBatchRenewBlocked, notifyBatchRenewed } from "@/lib/migz/notify";
import { BATCH_COLS, closeEndedBatch, getOpenBatch, type Batch } from "@/lib/dashboard/batches";
import { getBalanceCents } from "@/lib/dashboard/queries";
import { activateBatch } from "@/lib/dashboard/start-batch";
import { renewalGate, RENEW_WINDOW_DAYS } from "@/lib/renew-core";
import { DEFAULT_VIDEO_TIER, isVideoTier, setupVideoCents } from "@/lib/ad-options";

export type RenewOutcome = "renewed" | "waiting" | "stopped" | "none";

/**
 * Keep going: when an agent's batch has ended and was set to renew, starts the same plan again from their
 * free ad balance (the unspent money from the batch that ended is already back in it). Idempotent: a batch
 * renews once (renewed_from is unique), so the hourly cron and a dashboard visit can both call it.
 */
export async function renewForAgent(agent: Agent, now = new Date()): Promise<RenewOutcome> {
  await closeEndedBatch(agent).catch((e) => console.error("closing the ended batch failed", e));
  if (await getOpenBatch(agent.id)) return "none"; // one is running or planned
  const { data: last } = await supabaseAdmin
    .from("campaign_batches")
    .select(BATCH_COLS)
    .eq("agent_id", agent.id)
    .eq("status", "ended")
    .order("ended_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const batch = last as Batch | null;
  if (!batch?.renew) return "none";
  const { count } = await supabaseAdmin.from("campaign_batches").select("id", { count: "exact", head: true }).eq("renewed_from", batch.id);
  if (count) return "none";

  const verdict = renewalGate({
    batch,
    agent: {
      ads_paused: agent.ads_paused,
      migz_mode: agent.migz_mode,
      hasMeta: migzReadyFor(agent),
      onboarded: !!agent.onboarding_completed_at,
      focusCount: cleanFocus(agent.ad_focus).length,
    },
    balanceCents: await getBalanceCents(agent.id),
    videoCents: setupVideoCents(isVideoTier(agent.video_tier) ? agent.video_tier : DEFAULT_VIDEO_TIER),
    now,
  });
  if (verdict.action === "skip") return "none";

  if (verdict.action === "stop" || verdict.action === "wait") {
    const stopped = verdict.action === "stop";
    const first = batch.renew_blocked !== verdict.reason; // tell the agent once per reason
    await supabaseAdmin
      .from("campaign_batches")
      .update({ renew_blocked: verdict.reason, ...(stopped ? { renew: false } : {}) })
      .eq("id", batch.id);
    if (first) await notifyBatchRenewBlocked(agent, { reason: verdict.reason, stopped });
    return stopped ? "stopped" : "waiting";
  }

  // The same plan again; Migz already has the account's data, so it can revise from the first day
  const row = {
    agent_id: agent.id,
    budget_cents: batch.budget_cents,
    option: batch.option,
    campaigns: batch.campaigns,
    days: batch.days,
    daily_cents: batch.daily_cents,
    recommended_option: batch.recommended_option,
    reason: batch.reason,
    collect_days: 0,
    renew: true,
    renewed_from: batch.id,
  };
  const { data: next, error } = await supabaseAdmin.from("campaign_batches").insert({ ...row, status: "planned" }).select("id").single();
  if (error?.code === "23505") return "none"; // someone else renewed it a moment ago
  if (error || !next) {
    console.error("renewing the batch failed", error);
    return "none";
  }
  try {
    await activateBatch(agent, next.id, row, agent.migz_mode === "auto" ? "auto" : "approve", { continuing: true });
  } catch (e) {
    console.error("starting the renewed batch failed", e);
    await supabaseAdmin.from("campaign_batches").delete().eq("id", next.id).eq("status", "planned"); // frees the batch to try again
    return "none";
  }
  await supabaseAdmin.from("campaign_batches").update({ renew_blocked: null }).eq("id", batch.id);
  const balanceCents = await getBalanceCents(agent.id);
  await notifyBatchRenewed(agent, { budgetCents: row.budget_cents, days: row.days, dailyCents: row.daily_cents, balanceCents });
  return "renewed";
}

/** The agents whose batch is set to renew and is running or just ended, for the hourly cron. */
export async function renewBatches(deadlineMs: number) {
  const since = new Date(Date.now() - (RENEW_WINDOW_DAYS + 1) * 86_400_000).toISOString();
  const { data } = await supabaseAdmin
    .from("campaign_batches")
    .select("agent_id, status, ended_at")
    .eq("renew", true)
    .in("status", ["active", "ended"]);
  const ids = [...new Set((data ?? []).filter((b) => b.status === "active" || (b.ended_at ?? "") >= since).map((b) => b.agent_id))];
  if (!ids.length) return {};
  const { data: agents } = await supabaseAdmin.from("agents").select("*").in("id", ids).eq("active", true);
  const out: Record<string, RenewOutcome> = {};
  for (const agent of (agents ?? []) as Agent[]) {
    if (Date.now() > deadlineMs) break;
    out[agent.slug] = await renewForAgent(agent).catch((e) => {
      console.error("renewal failed", agent.slug, e);
      return "none" as const;
    });
  }
  return out;
}

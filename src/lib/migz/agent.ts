import "server-only";
import { DateTime } from "luxon";
import { supabaseAdmin } from "@/lib/supabase-admin";
import type { Agent } from "@/lib/booking/data";
import { createAdSet, createCampaign, getAdSet, setDailyBudget, setEndTime, setStates, setStatus, stateRegionKeys } from "@/lib/meta/ads";
import { batchEndTime, EXPLORE, pacedDailyCents, splitDaily, type CampaignSlot } from "@/lib/batch";
import { isCarouselBrief, isVideoBrief, type AnyBrief, type CreativeBrief } from "@/lib/migz/brief";
import { buildSnapshot, type Snapshot } from "@/lib/migz/snapshot";
import { syncAgent } from "@/lib/migz/sync";
import { begin, emit, metaStep } from "@/lib/migz/events";
import { closeEndedBatch, ensureBatchSetAside, getActiveBatch, type Batch } from "@/lib/dashboard/batches";
import { campaignEnded, campaignLabels, daysLeft as daysLeftIn, pickCarryOver, planTopic } from "@/lib/campaign";
import { cleanFocus, isTopic, type TopicKey } from "@/lib/migz/topics";
import { MIN_ADSET_BUDGET_CENTS } from "@/lib/migz/guardrails";
import { isTestMode } from "@/lib/migz/test-mode";
import { gateState, materialChanges, type GateState } from "@/lib/migz/gate";
import { MODELS } from "@/lib/migz/models";
import { runOperator, type ExtraTool } from "@/lib/migz/operator";
import { copyAdInto } from "@/lib/migz/executor";
import { defaultCreateMessage, monthlyBudget, type Budget, type CreateMessage } from "@/lib/migz/router";
import { EXPERIMENT_TOOLS, experimentContext } from "@/lib/migz/experiments";
import { diagnoseCreativeTool, watchNewCreatives } from "@/lib/migz/vision";
import { runRoutines } from "@/lib/migz/routines";
import { audit } from "@/lib/migz/team/auditor";
import { writeFeed } from "@/lib/migz/team/clerk";
import { alertCriticalFindings, alertReviewFailed } from "@/lib/migz/slack";
import { notifyBatchSetup, notifyReviewSummary } from "@/lib/migz/notify";
import { runScout } from "@/lib/migz/team/scout";
import { READ_TOOLS } from "@/lib/migz/team/tools";
import type { EvalContext } from "@/lib/migz/tools";

export type { CreateMessage } from "@/lib/migz/router";

/**
 * MIGZ_TEST_MODE=1: everything is created for real (campaign, ad set, uploads, ads) but the campaign
 * stays paused, so nothing delivers or spends. Remove the flag and the next review switches it on.
 */
export { isTestMode };

/** Operator tools and team context beyond the core: experiments, creative vision, pro routines. */
type Extension = {
  tools?: ExtraTool[];
  /** Adds to the team context the operator reads, and can report reasons to run (e.g. experiments ready). */
  context?: (agent: Agent, snapshot: Snapshot) => Promise<{ context: Record<string, unknown>; reasons: string[] }>;
  /** Runs once the gate decides a full review is due, before the operator starts. */
  beforeReview?: (agent: Agent, team: { runId: string; budget: Budget; createMessage: CreateMessage }) => Promise<unknown>;
};
const extensions: Extension[] = [
  { tools: EXPERIMENT_TOOLS, context: experimentContext },
  { tools: [diagnoseCreativeTool], beforeReview: watchNewCreatives },
];

async function logAction(agentId: string, row: Record<string, unknown>) {
  const { data } = await supabaseAdmin
    .from("ad_actions")
    .insert({ agent_id: agentId, ...row })
    .select("id")
    .single();
  return (data?.id as string) ?? null;
}

export async function buildEvalContext(agent: Agent, snapshot: Snapshot): Promise<EvalContext> {
  const { data: scripted } = await supabaseAdmin
    .from("ads")
    .select("meta_ad_id, creative_id, status, ad_sets(meta_adset_id), creatives(script, meta_video_id, meta_image_hash)")
    .eq("agent_id", agent.id)
    .not("creative_id", "is", null);

  const scriptedAds = new Map<string, { creative_id: string; script: CreativeBrief; meta_adset_id: string }>();
  const reusableAds = new Map<string, string>();
  for (const row of scripted ?? []) {
    const media = row.creatives as { meta_video_id?: string | null; meta_image_hash?: string | null } | null;
    const set = (row.ad_sets as { meta_adset_id?: string } | null)?.meta_adset_id;
    const script = (row.creatives as { script?: AnyBrief } | null)?.script;
    // A carousel's media is two cards; reusing its first card's image would make a different ad
    if (set && row.status === "ACTIVE" && (media?.meta_video_id || media?.meta_image_hash) && !(script && isCarouselBrief(script))) reusableAds.set(row.meta_ad_id, set);
    const adset = row.ad_sets as { meta_adset_id?: string } | null;
    // Only videos have a body to reuse with a new hook
    if (script && isVideoBrief(script) && adset?.meta_adset_id && row.creative_id) {
      scriptedAds.set(row.meta_ad_id, { creative_id: row.creative_id, script, meta_adset_id: adset.meta_adset_id });
    }
  }

  return {
    now: new Date(),
    dailyCapCents: agent.daily_budget_cents,
    adsets: snapshot.guardAdsets,
    actionsThisRun: 0,
    generationsThisRun: 0,
    videosThisRun: 0,
    testMode: isTestMode(),
    revisionsFrom: snapshot.revisionsFrom ? DateTime.fromISO(snapshot.revisionsFrom, { zone: agent.timezone }).toJSDate() : null,
    batchDaysLeft: agent.campaign_ends_on ? daysLeftIn(agent.campaign_ends_on, agent.timezone) : null,
    ...(snapshot.creditsRecentlyRefused ? { maxGenerations: 1 } : {}),
    openGenerations: snapshot.openGenerations,
    scriptedAds,
    reusableAds,
    libraryCreativeIds: new Set(snapshot.forModel.creatives_not_running.map((c) => c.creative_id)),
  };
}

/**
 * Safety switch that runs before any AI decision: pause every ad set if the agent paused ads or the
 * balance can't cover a day of spend; resume what this switch paused once that's fixed.
 */
async function enforceSpendState(agent: Agent, snapshot: Snapshot, runId: string, budgetUsed = false, inBatch = false) {
  const active = snapshot.guardAdsets.filter((a) => a.status === "ACTIVE");
  // A running batch's money is already set aside (the balance shows $0), so it's funded until its budget runs out
  const lowBalance = !inBatch && snapshot.balanceCents < agent.daily_budget_cents;
  // The agent chose how long the campaign runs; after its last day (or once its budget is spent), ads stop
  const ended = campaignEnded(agent.campaign_ends_on, agent.timezone) || budgetUsed;

  if ((agent.ads_paused || lowBalance || ended) && active.length) {
    await metaStep({ agentId: agent.id, runId, summary: "Pausing your ad sets" }, async () => {
      for (const adset of active) await setStatus(adset.meta_adset_id, "PAUSED");
    });
    await supabaseAdmin
      .from("ad_sets")
      .update({ status: "PAUSED", updated_at: new Date().toISOString() })
      .in("meta_adset_id", active.map((a) => a.meta_adset_id));
    await logAction(agent.id, {
      kind: "pause",
      title: agent.ads_paused ? "Paused your ads" : budgetUsed ? "Your batch budget is used up" : ended ? "Your campaign batch has ended" : "Paused ads: balance is low",
      detail: agent.ads_paused
        ? "You turned ads off. They'll stay paused until you turn them back on."
        : budgetUsed
          ? "This batch has spent its budget, so Migz paused your ads a little early rather than go over. Anything left stays in your balance for the next batch."
          : ended
          ? `Your campaign batch ran until ${agent.campaign_ends_on}, so Migz paused your ads. To keep going, start your next batch from the Overview.`
          : `Your balance ($${(snapshot.balanceCents / 100).toFixed(2)}) can't cover a day at $${(agent.daily_budget_cents / 100).toFixed(2)}/day. Add funds to resume.`,
      status: "applied",
      tool: "system_pause",
      payload: { adset_ids: active.map((a) => a.meta_adset_id) },
      run_id: runId,
    });
    return "paused";
  }

  if (!agent.ads_paused && !lowBalance && !ended) {
    const { data: last } = await supabaseAdmin
      .from("ad_actions")
      .select("tool, payload")
      .eq("agent_id", agent.id)
      .in("tool", ["system_pause", "system_resume"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (last?.tool === "system_pause") {
      const ids = ((last.payload as { adset_ids?: string[] })?.adset_ids ?? []).filter((id) =>
        snapshot.guardAdsets.some((a) => a.meta_adset_id === id && a.status === "PAUSED"),
      );
      if (ids.length)
        await metaStep({ agentId: agent.id, runId, summary: "Turning your ad sets back on" }, async () => {
          for (const id of ids) await setStatus(id, "ACTIVE");
        });
      if (ids.length) {
        await supabaseAdmin.from("ad_sets").update({ status: "ACTIVE" }).in("meta_adset_id", ids);
      }
      await logAction(agent.id, {
        kind: "launch",
        title: "Resumed your ads",
        detail: "Ads are on and funded again, so delivery picked back up.",
        status: "applied",
        tool: "system_resume",
        payload: { adset_ids: ids },
        run_id: runId,
      });
      return "resumed";
    }
  }
  return agent.ads_paused || lowBalance || ended ? "paused" : "ok";
}

/** Keeps campaigns paused in test mode; switches them on the first review after test mode is removed. */
async function syncCampaignSwitch(agent: Agent, runId: string) {
  const want = isTestMode() ? "PAUSED" : "ACTIVE";
  const { data: campaigns } = await supabaseAdmin
    .from("ad_campaigns")
    .select("id, meta_campaign_id, status")
    .eq("agent_id", agent.id)
    .is("retired_at", null) // paused because a batch doesn't use them
    .neq("status", want);
  for (const c of campaigns ?? []) {
    await metaStep({ agentId: agent.id, runId, summary: want === "ACTIVE" ? "Turning your campaign on" : "Pausing your campaign for testing" }, () => setStatus(c.meta_campaign_id, want));
    await supabaseAdmin.from("ad_campaigns").update({ status: want, updated_at: new Date().toISOString() }).eq("id", c.id);
    // Going live for the first time: the campaign switch alone does nothing while its ad sets are still
    // paused, so turn them on too (unless the agent has paused their ads themselves)
    let resumed = 0;
    let heldOn = 0;
    if (want === "ACTIVE" && !agent.ads_paused) {
      const { data: sets } = await supabaseAdmin.from("ad_sets").select("id, meta_adset_id").eq("campaign_id", c.id).eq("status", "PAUSED");
      for (const set of sets ?? []) {
        await setStatus(set.meta_adset_id, "ACTIVE");
        await supabaseAdmin.from("ad_sets").update({ status: "ACTIVE", updated_at: new Date().toISOString() }).eq("id", set.id);
        resumed++;
      }
      // Ads built paused during test mode go live with the campaign
      const { data: held } = await supabaseAdmin.from("ads").select("id, meta_ad_id").eq("agent_id", agent.id).eq("held_by_test_mode", true);
      for (const ad of held ?? []) {
        await setStatus(ad.meta_ad_id, "ACTIVE");
        await supabaseAdmin.from("ads").update({ status: "ACTIVE", held_by_test_mode: false, updated_at: new Date().toISOString() }).eq("id", ad.id);
        heldOn++;
      }
    }
    await logAction(agent.id, {
      kind: want === "ACTIVE" ? "launch" : "pause",
      title: want === "ACTIVE" ? "Turned your campaign on" : "Paused your campaign for testing",
      detail: want === "ACTIVE" ? `Test mode is off, so ads can now deliver${resumed ? ` (${resumed} ad set${resumed === 1 ? "" : "s"} switched on too)` : ""}${heldOn ? ` and ${heldOn} ad${heldOn === 1 ? "" : "s"} you'd approved were switched on` : ""}.` : "Test mode is on: ads are built but won't deliver or spend.",
      status: "applied",
      tool: "system_test_mode",
      run_id: runId,
    });
  }
}

/**
 * Keeps one campaign per planned slot. With an active batch the slots are the batch's campaigns (the
 * plan the agent chose: one main campaign, on one topic or on all of them, maybe with an exploration
 * campaign); without one, a single campaign over the focus topics. Older batches had several and keep
 * them until the next batch. Creates the missing ones; a campaign made before campaigns had topics takes
 * the first main slot left. The first review of a new batch also pauses (retires) campaigns the batch
 * doesn't use, brings back retired ones it does, and gives every campaign its share of the batch's daily
 * spend (splitDaily). With one main campaign, each campaign keeps one ad set, and the best live ads from
 * what it retired are carried into the main one (carryOverAds).
 * Returns true when it changed anything.
 */
export async function syncCampaignPlan(agent: Agent, runId: string | null, batch: Batch | null) {
  const focus = cleanFocus(agent.ad_focus);
  const slots: CampaignSlot[] = batch ? batch.campaigns.map((t) => (t === EXPLORE ? EXPLORE : isTopic(t) ? t : null)) : [planTopic(focus)];
  const roleOf = (slot: CampaignSlot) => (slot === EXPLORE ? "explore" : "main");
  const topicOf = (slot: CampaignSlot) => (slot === EXPLORE ? null : slot);
  const single = slots.filter((t) => t !== EXPLORE).length === 1;
  const applying = !!batch && !batch.applied_at;
  const { data: existing, error } = await supabaseAdmin
    .from("ad_campaigns")
    .select("id, topic, role, meta_campaign_id, retired_at")
    .eq("agent_id", agent.id)
    .not("status", "in", "(DELETED,ARCHIVED)");
  // Never guess: an unreadable list would look empty and duplicate every campaign in Meta
  if (error) throw new Error(`Couldn't read the agent's campaigns (have the latest migrations run?): ${error.message}`);

  // A new batch may bring back a retired campaign for a slot it uses; otherwise retired ones stay out
  const pool = (existing ?? []).filter((c) => applying || !c.retired_at);
  const claimed: typeof pool = [];
  const slotOf = new Map<string, number>(); // campaign id -> its slot
  const missing: number[] = [];
  for (const [i, slot] of slots.entries()) {
    const topic = topicOf(slot);
    const role = roleOf(slot);
    const pick = (ok: (c: (typeof pool)[number]) => boolean) => pool.findIndex((c) => c.role === role && ok(c));
    let j = pick((c) => c.topic === topic && !c.retired_at);
    if (j === -1) j = pick((c) => c.topic === topic);
    if (j === -1 && role === "main") j = pick((c) => c.topic === null && !c.retired_at);
    if (j === -1) {
      missing.push(i);
      continue;
    }
    const [c] = pool.splice(j, 1);
    claimed.push(c);
    slotOf.set(c.id, i);
    if (c.topic !== topic) await supabaseAdmin.from("ad_campaigns").update({ topic }).eq("id", c.id);
  }
  const unused = pool.filter((c) => !c.retired_at);
  if (!missing.length && !applying) return false;

  if (!agent.licensed_states.length) throw new Error("Add the agent's licensed states before Migz can launch ads.");
  const account = agent.meta_ad_account_id!;
  const labels = campaignLabels(slots, focus);
  // Each slot's share of the daily spend; campaigns outside the plan (only before a new batch retires
  // them) split evenly with the rest
  const others = applying ? 0 : (existing ?? []).filter((c) => !c.retired_at && !slotOf.has(c.id)).length;
  const shares = splitDaily(agent.daily_budget_cents, [...slots, ...Array.from({ length: others }, (): CampaignSlot => null)]);
  const centsFor = (slot: number | undefined) => Math.max(MIN_ADSET_BUDGET_CENTS, shares[slot ?? slots.length] ?? shares.at(-1)!);
  const campaignStatus = isTestMode() ? "PAUSED" : "ACTIVE";
  // Meta stops delivery itself at the end of the batch's last day, even if our reviews stop running
  const endTime = batch?.ends_on ? batchEndTime(batch.ends_on, agent.timezone) : null;
  const adsetName = `${agent.licensed_states.join(", ")} · adults 18+`;
  const now = () => new Date().toISOString();
  // Ad sets whose live ads a one-campaign batch may carry over: the retired campaigns', and any extra
  // ad set in the kept campaign (an older batch's test ad set)
  const sources: string[] = [];
  let carried = 0;

  await metaStep({ agentId: agent.id, runId, summary: applying ? "Setting up campaigns for your new batch" : "Building your planned campaigns" }, async () => {
    if (applying) {
      for (const c of unused) {
        await setStatus(c.meta_campaign_id, "PAUSED");
        await supabaseAdmin.from("ad_campaigns").update({ status: "PAUSED", retired_at: now(), updated_at: now() }).eq("id", c.id);
      }
      if (single && unused.length) {
        const { data: retiredSets } = await supabaseAdmin.from("ad_sets").select("id").in("campaign_id", unused.map((c) => c.id)).neq("status", "DELETED");
        sources.push(...(retiredSets ?? []).map((x) => x.id));
      }
      for (const c of claimed.filter((x) => x.retired_at)) {
        if (campaignStatus === "ACTIVE") await setStatus(c.meta_campaign_id, "ACTIVE");
        await supabaseAdmin.from("ad_campaigns").update({ status: campaignStatus, retired_at: null, updated_at: now() }).eq("id", c.id);
      }
    }

    // Campaigns the plan keeps get their share of the daily spend
    const keptIds = applying ? claimed.map((c) => c.id) : (existing ?? []).filter((c) => !c.retired_at).map((c) => c.id);
    if (keptIds.length) {
      const { data: sets } = await supabaseAdmin
        .from("ad_sets")
        .select("id, campaign_id, meta_adset_id, daily_budget_cents, status")
        .in("campaign_id", keptIds)
        .neq("status", "DELETED")
        .order("created_at");
      // A one-campaign batch runs one ad set: the kept campaign's first live one (else its first)
      const primary = new Map<string, string>();
      for (const set of sets ?? []) if (set.status === "ACTIVE" && !primary.has(set.campaign_id)) primary.set(set.campaign_id, set.id);
      for (const set of sets ?? []) if (!primary.has(set.campaign_id)) primary.set(set.campaign_id, set.id);
      for (const set of sets ?? []) {
        if (applying && single && primary.get(set.campaign_id) !== set.id) {
          if (set.status === "ACTIVE") {
            await setStatus(set.meta_adset_id, "PAUSED");
            await supabaseAdmin.from("ad_sets").update({ status: "PAUSED", updated_at: now() }).eq("id", set.id);
          }
          sources.push(set.id);
          continue;
        }
        if (applying && endTime) await setEndTime(set.meta_adset_id, endTime);
        // A new batch brings back ad sets the last one paced off (the agent's own pause still wins)
        if (applying && set.status === "PAUSED" && !agent.ads_paused) {
          await setStatus(set.meta_adset_id, "ACTIVE");
          await supabaseAdmin.from("ad_sets").update({ status: "ACTIVE", updated_at: now() }).eq("id", set.id);
        }
        const budget = centsFor(slotOf.get(set.campaign_id));
        if (set.daily_budget_cents === budget) continue;
        await setDailyBudget(set.meta_adset_id, budget);
        await supabaseAdmin.from("ad_sets").update({ daily_budget_cents: budget, last_edited_at: now(), updated_at: now() }).eq("id", set.id);
      }
    }

    for (const i of missing) {
      const name = `Migz · ${labels[i]} · ${agent.licensed_states.join(" ")}`;
      const campaignId = await createCampaign(account, name);
      if (campaignStatus === "ACTIVE") await setStatus(campaignId, "ACTIVE"); // spends nothing until ads exist
      const adsetId = await createAdSet(account, {
        campaignId,
        name: adsetName,
        dailyBudgetCents: centsFor(i),
        pixelId: process.env.META_PIXEL_ID!,
        states: agent.licensed_states,
        placements: [],
        status: "ACTIVE",
        endTime,
      });
      const { data: campaign } = await supabaseAdmin
        .from("ad_campaigns")
        .insert({ agent_id: agent.id, meta_campaign_id: campaignId, name, status: campaignStatus, topic: topicOf(slots[i]), role: roleOf(slots[i]) })
        .select("id")
        .single();
      claimed.push({ id: campaign!.id, topic: topicOf(slots[i]), role: roleOf(slots[i]), meta_campaign_id: campaignId, retired_at: null });
      slotOf.set(campaign!.id, i);
      await supabaseAdmin.from("ad_sets").insert({
        agent_id: agent.id,
        campaign_id: campaign!.id,
        meta_adset_id: adsetId,
        name: adsetName,
        status: "ACTIVE",
        daily_budget_cents: centsFor(i),
        states: agent.licensed_states,
      });
    }
    const main = claimed.find((c) => c.role === "main");
    if (applying && single && main) carried = await carryOverAds(agent, { campaignId: main.id, topic: topicOf(slots[slotOf.get(main.id)!]) }, sources);
    if (applying) await supabaseAdmin.from("campaign_batches").update({ applied_at: now() }).eq("id", batch!.id);
  });

  const made = missing.map((i) => labels[i]);
  const usd = (c: number) => `$${(c / 100).toFixed(2)}/day`;
  const perDay = usd(centsFor(0));
  const plan = slots.map((_, i) => `${labels[i]} at ${usd(centsFor(i))}`).join(" and ");
  await logAction(agent.id, {
    kind: "launch",
    title: applying
      ? `Set up your $${(batch!.budget_cents / 100).toFixed(0)} batch`
      : made.length === 1 ? `Set up your ${made[0]} campaign` : `Set up ${made.length} campaigns`,
    detail: applying
      ? `${slots.length === 1 ? "One campaign" : `${slots.length} campaigns`}: ${plan}, for ${batch!.days} days, targeting ${agent.licensed_states.join(", ")}.${made.length ? ` New: ${made.join(", ")}.` : ""}${unused.length ? ` Paused ${unused.length} campaign${unused.length === 1 ? "" : "s"} this batch doesn't use.` : ""}${carried ? ` Carried over ${carried} of the best live ad${carried === 1 ? "" : "s"} from them.` : ""} Ads go live as creatives are approved.`
      : `${made.join(", ")}. Each targets adults in ${agent.licensed_states.join(", ")} at ${perDay}, optimized for booked calls${existing?.length ? `; your other campaigns moved to ${perDay} so the total stays within your daily budget` : ""}. Ads go live as creatives are approved.`,
    status: "applied",
    tool: "system_setup",
    run_id: runId,
  });
  await notifyBatchSetup(agent, {
    budgetCents: batch?.budget_cents ?? null,
    days: batch?.days ?? null,
    campaigns: labels,
    perCampaignCents: centsFor(0),
    campaignCents: slots.map((_, i) => centsFor(i)),
    endsOn: batch?.ends_on ?? null,
  });
  return true;
}

// Live ads a one-campaign batch starts with: enough to compare, few enough that each gets real spend
const CARRY_OVER_ADS = 4;

/**
 * Copies the best live ads from retired ad sets into the campaign's ad set, up to CARRY_OVER_ADS live
 * ads, so a batch that folds several campaigns into one doesn't start from nothing (which ones:
 * pickCarryOver; how: copyAdInto). Returns how many were carried over.
 */
async function carryOverAds(agent: Agent, target: { campaignId: string; topic: TopicKey | null }, sourceAdsetIds: string[]) {
  if (!sourceAdsetIds.length) return 0;
  const { data: set } = await supabaseAdmin
    .from("ad_sets")
    .select("id, meta_adset_id")
    .eq("campaign_id", target.campaignId)
    .eq("status", "ACTIVE")
    .order("created_at")
    .limit(1)
    .maybeSingle();
  if (!set) return 0;
  const [{ data: live }, { data: candidates }] = await Promise.all([
    supabaseAdmin.from("ads").select("creative_id").eq("adset_id", set.id).eq("status", "ACTIVE"),
    supabaseAdmin
      .from("ads")
      .select("id, meta_ad_id, meta_creative_id, creative_id, name, primary_text, headline, creatives(script), ad_sets(ad_campaigns(topic))")
      .in("adset_id", sourceAdsetIds)
      .eq("status", "ACTIVE")
      .not("meta_creative_id", "is", null),
  ]);
  const room = CARRY_OVER_ADS - (live?.length ?? 0);
  if (room <= 0 || !candidates?.length) return 0;

  const since = DateTime.now().setZone(agent.timezone).minus({ days: 13 }).toISODate()!;
  const { data: rows } = await supabaseAdmin
    .from("ad_insights_daily")
    .select("meta_ad_id, spend_cents")
    .eq("agent_id", agent.id)
    .gte("date", since)
    .in("meta_ad_id", candidates.map((a) => a.meta_ad_id));
  const spent = new Map<string, number>();
  for (const r of rows ?? []) spent.set(r.meta_ad_id, (spent.get(r.meta_ad_id) ?? 0) + r.spend_cents);

  // An ad's topic: the creative's tag, else the topic of the campaign it ran in
  type Nested = { creatives: { script?: { topic?: string } | null } | null; ad_sets: { ad_campaigns: { topic: string | null } | null } | null };
  const picks = pickCarryOver(
    candidates.map((a) => {
      const n = a as unknown as Nested;
      return { ...a, topic: n.creatives?.script?.topic ?? n.ad_sets?.ad_campaigns?.topic ?? null };
    }),
    { room, topic: target.topic, spentCents: spent, running: new Set((live ?? []).map((a) => a.creative_id).filter(Boolean)) },
  );

  for (const a of picks) await copyAdInto(agent, a, set.meta_adset_id);
  return picks.length;
}

type Pacing = { budgetCents: number; spentCents: number; daysLeft: number; dailyCapCents: number; budgetUsed: boolean };

/** How the active batch is spending against its budget, and the daily cap that keeps it inside (pacedDailyCents). */
export async function batchPacing(agent: Agent, batch: Batch | null): Promise<Pacing | null> {
  if (!batch?.starts_on || !batch.ends_on) return null;
  const { data } = await supabaseAdmin
    .from("ad_insights_daily")
    .select("spend_cents")
    .eq("agent_id", agent.id)
    .gte("date", batch.starts_on)
    .lte("date", batch.ends_on);
  const spentCents = (data ?? []).reduce((s, r) => s + r.spend_cents, 0);
  const today = DateTime.now().setZone(agent.timezone).startOf("day");
  const daysLeft = Math.max(0, Math.round(DateTime.fromISO(batch.ends_on, { zone: agent.timezone }).diff(today, "days").days) + 1);
  const dailyCapCents = pacedDailyCents({ budgetCents: batch.budget_cents, spentCents, daysLeft, plannedDailyCents: batch.daily_cents });
  // Below one ad set's minimum there's nothing sensible left to run: the budget is used up
  return { budgetCents: batch.budget_cents, spentCents, daysLeft, dailyCapCents, budgetUsed: dailyCapCents < MIN_ADSET_BUDGET_CENTS };
}

/**
 * Brings the live ad sets' daily budgets down to the paced cap when they're above it, keeping Migz's
 * split between them. If the cap can't give every ad set the $5 minimum, the smallest are paused.
 * Only ever lowers budgets: an underspent batch just leaves money in the balance.
 */
async function paceBudgets(agent: Agent, runId: string, pacing: Pacing) {
  const { data } = await supabaseAdmin
    .from("ad_sets")
    .select("id, meta_adset_id, daily_budget_cents, ad_campaigns!inner(retired_at)")
    .eq("agent_id", agent.id)
    .eq("status", "ACTIVE")
    .is("ad_campaigns.retired_at", null);
  const live = data ?? [];
  const total = live.reduce((s, x) => s + x.daily_budget_cents, 0);
  if (!live.length || total <= pacing.dailyCapCents) return false;

  const keep = Math.max(1, Math.min(live.length, Math.floor(pacing.dailyCapCents / MIN_ADSET_BUDGET_CENTS)));
  const ranked = [...live].sort((a, b) => b.daily_budget_cents - a.daily_budget_cents);
  const kept = ranked.slice(0, keep);
  const dropped = ranked.slice(keep);
  const keptTotal = kept.reduce((s, x) => s + x.daily_budget_cents, 0);
  const next = kept.map((x) => ({ ...x, cents: Math.max(MIN_ADSET_BUDGET_CENTS, Math.floor((x.daily_budget_cents * pacing.dailyCapCents) / keptTotal)) }));
  const now = new Date().toISOString();

  await metaStep({ agentId: agent.id, runId, summary: "Pacing your batch so it can't go over budget" }, async () => {
    for (const x of next) {
      if (x.cents === x.daily_budget_cents) continue;
      await setDailyBudget(x.meta_adset_id, x.cents);
      await supabaseAdmin.from("ad_sets").update({ daily_budget_cents: x.cents, last_edited_at: now, updated_at: now }).eq("id", x.id);
    }
    for (const x of dropped) {
      await setStatus(x.meta_adset_id, "PAUSED");
      await supabaseAdmin.from("ad_sets").update({ status: "PAUSED", updated_at: now }).eq("id", x.id);
    }
  });
  const usd = (c: number) => `$${(c / 100).toFixed(2)}`;
  await logAction(agent.id, {
    kind: "budget",
    title: `Paced your batch to stay within ${usd(pacing.budgetCents)}`,
    detail: `${usd(pacing.spentCents)} spent with ${pacing.daysLeft} day${pacing.daysLeft === 1 ? "" : "s"} left. Meta can spend up to 25% over a daily budget on any day, so Migz set your campaigns to ${usd(next.reduce((s, x) => s + x.cents, 0))}/day in total${dropped.length ? ` and paused ${dropped.length} smaller ad set${dropped.length === 1 ? "" : "s"}` : ""}. Anything left over stays in your balance.`,
    status: "applied",
    tool: "system_pace",
    payload: { daily_cap_cents: pacing.dailyCapCents, adset_ids: live.map((x) => x.meta_adset_id) },
    run_id: runId,
  });
  return true;
}

/**
 * Keeps every ad set on the agent's licensed states. When the agent adds or removes a state, the
 * targeting is updated in Meta (ads must never reach people in states the agent can't sell in).
 */
async function syncTargeting(agent: Agent, runId: string | null) {
  if (!agent.licensed_states.length) return 0;
  const want = [...agent.licensed_states].sort();
  const { data: sets, error } = await supabaseAdmin
    .from("ad_sets")
    .select("id, meta_adset_id, states, ad_campaigns!inner(retired_at)")
    .eq("agent_id", agent.id)
    .neq("status", "DELETED")
    .is("ad_campaigns.retired_at", null);
  if (error) return 0; // before the batches migration
  const stale = (sets ?? []).filter((s) => !s.states || [...s.states].sort().join() !== want.join());
  if (!stale.length) return 0;
  let changed = 0;
  await metaStep({ agentId: agent.id, runId, summary: `Checking your ads target ${want.join(", ")}` }, async () => {
    const keys = (await stateRegionKeys(want)).map((k) => k.key).sort();
    for (const s of stale) {
      // Ad sets made before states were recorded: compare with what Meta actually targets
      const current = await getAdSet(s.meta_adset_id);
      const regions = ((current.targeting?.geo_locations as { regions?: { key: string }[] } | undefined)?.regions ?? []).map((r) => r.key).sort();
      if (regions.join() !== keys.join()) {
        await setStates(s.meta_adset_id, want);
        changed++;
      }
      await supabaseAdmin.from("ad_sets").update({ states: want, ...(regions.join() !== keys.join() ? { last_edited_at: new Date().toISOString() } : {}) }).eq("id", s.id);
    }
  }, () => `Your ads target ${want.join(", ")}${changed ? ` (updated ${changed} ad set${changed === 1 ? "" : "s"})` : ""}`);
  if (changed) {
    await logAction(agent.id, {
      kind: "audience",
      title: "Updated your ads to your licensed states",
      detail: `Your ads now reach adults in ${want.join(", ")} only, matching the states on your profile.`,
      status: "applied",
      tool: "system_targeting",
      run_id: runId,
    });
  }
  return changed;
}

/**
 * Runs right after the agent saves their licensed states, instead of waiting up to 6 hours for the next
 * review: re-targets every ad set to the new states, or pauses all ads if no states are left (ads must
 * never reach people where the agent can't sell).
 */
export async function retargetNow(agent: Agent) {
  if (!agent.meta_ad_account_id) return;
  if (agent.licensed_states.length) return syncTargeting(agent, null);
  const { data: live } = await supabaseAdmin.from("ad_sets").select("id, meta_adset_id").eq("agent_id", agent.id).eq("status", "ACTIVE");
  if (!live?.length) return 0;
  await metaStep({ agentId: agent.id, runId: null, summary: "Pausing your ads: no licensed states" }, async () => {
    for (const s of live) await setStatus(s.meta_adset_id, "PAUSED");
  });
  await supabaseAdmin.from("ad_sets").update({ status: "PAUSED", updated_at: new Date().toISOString() }).in("id", live.map((s) => s.id));
  await logAction(agent.id, {
    kind: "pause",
    title: "Paused your ads: no licensed states",
    detail: "Your profile has no licensed states, so Migz paused your ads. Add the states you're licensed in and they'll target those.",
    status: "applied",
    tool: "system_pause",
    payload: { adset_ids: live.map((s) => s.meta_adset_id) },
    run_id: null,
  });
  return live.length;
}

/**
 * One Migz cycle: sync (code) -> audit (code + Haiku) -> market research when due (Haiku) -> the
 * quiet-run gate (code) -> the review (Sonnet, advised by Opus) -> feed wording (Haiku).
 */
export async function runMigz(
  agent: Agent,
  opts: { trigger?: "schedule" | "manual"; createMessage?: CreateMessage } = {},
) {
  const trigger = opts.trigger ?? "schedule";
  const createMessage = opts.createMessage ?? defaultCreateMessage;
  // Migz only manages ads once the agent has finished setup ("Start my campaign" starts their first
  // batch). Before that, adding funds alone must never make Migz build campaigns in their account.
  if (!agent.onboarding_completed_at) return { runId: null, status: "setup_not_finished" as const };
  const { data: run } = await supabaseAdmin
    .from("migz_runs")
    .insert({ agent_id: agent.id, trigger, model: MODELS.sonnet })
    .select("id")
    .single();
  const runId = run!.id as string;
  const cost = async () => {
    const { data } = await supabaseAdmin.from("model_calls").select("cost_usd").eq("run_id", runId);
    return (data ?? []).reduce((s, r) => s + Number(r.cost_usd), 0);
  };

  try {
    // A batch whose last day is over is closed with its results; its ads pause below
    await closeEndedBatch(agent).catch((e) => console.error("closing the batch failed", e));
    await ensureBatchSetAside(agent).catch((e) => console.error("setting the batch's money aside failed", e));
    let snapshot = await buildSnapshot(agent);
    if (snapshot.hasCampaign) {
      const done = await begin({ agentId: agent.id, runId, step: "syncing", tier: "code", summary: "Pulling results from Meta" });
      await syncAgent(agent);
      snapshot = await buildSnapshot(agent);
      const t = snapshot.forModel.account_last_14_days;
      await done({ summary: `Synced 14 days: ${t.spend} spent, ${t.impressions} impressions, ${t.booked_calls} booked calls`, evidence: t });
    }

    await syncCampaignSwitch(agent, runId);
    const batch = await getActiveBatch(agent.id);
    const pacing = await batchPacing(agent, batch);
    const spend = await enforceSpendState(agent, snapshot, runId, pacing?.budgetUsed ?? false, !!batch);
    if (spend === "paused") {
      await finish(runId, agent.id, { summary: "Ads are paused, so Migz made no changes." });
      await emit({ agentId: agent.id, runId, step: "finished", tier: "code", summary: "Ads are paused, so Migz made no changes." });
      return { runId, status: "paused" as const };
    }

    if (await syncCampaignPlan(agent, runId, batch)) snapshot = await buildSnapshot(agent);
    if (await syncTargeting(agent, runId)) snapshot = await buildSnapshot(agent);
    if (pacing && (await paceBudgets(agent, runId, pacing))) snapshot = await buildSnapshot(agent);

    const budget = await monthlyBudget(agent.id, agent.migz_model_budget_cents ?? 3000, agent.timezone);
    const team = { runId, budget, createMessage };
    const audited = await audit(agent, snapshot, team);
    await alertCriticalFindings(agent, audited.findings).catch(() => {});
    await runScout({ agentId: agent.id, ...team });
    const routines = await runRoutines(agent, snapshot, team);

    // Phase extensions (experiments, vision, routines) add context and reasons to run
    const teamContext: Record<string, unknown> = {
      ...(pacing
        ? {
            batch_pacing: {
              budget: `$${(pacing.budgetCents / 100).toFixed(2)}`,
              spent_so_far: `$${(pacing.spentCents / 100).toFixed(2)}`,
              days_left: pacing.daysLeft,
              most_all_campaigns_may_spend_per_day_now: `$${(pacing.dailyCapCents / 100).toFixed(2)}`,
              why: "Meta can spend up to 25% over a daily budget on any day. The system paces budgets (harder in the last 7 days) so the batch can't finish over budget, and refuses budget changes above this cap.",
            },
          }
        : {}),
      open_audit_findings: audited.findings.slice(0, 10).map((f) => ({ check: f.check, severity: f.severity, summary: f.summary })),
      model_budget_this_month: `$${budget.spentUsd.toFixed(2)} of $${budget.limitUsd.toFixed(2)}; today $${budget.todayUsd.toFixed(2)} of a $${budget.dailyUsd.toFixed(2)} daily allowance (what's left ÷ days left)`,
    };
    Object.assign(teamContext, routines.context);
    const extraReasons: string[] = [...routines.reasons];
    const extraTools: ExtraTool[] = [...READ_TOOLS];
    for (const ext of extensions) {
      if (ext.tools) extraTools.push(...ext.tools);
      if (ext.context) {
        const out = await ext.context(agent, snapshot);
        Object.assign(teamContext, out.context);
        extraReasons.push(...out.reasons);
      }
    }

    const reasons = materialChanges({
      trigger,
      snapshot,
      previous: (agent.migz_gate_state as GateState | null) ?? null,
      lastOperatorAt: agent.migz_last_operator_at ?? null,
      auditMaterial: audited.material,
      experimentsReady: 0,
      routinesDue: [],
    }).concat(extraReasons);

    if (!reasons.length) {
      await emit({ agentId: agent.id, runId, step: "skipped", tier: "code", summary: "skipped: quiet (nothing material changed since the last review)", evidence: gateState(snapshot) });
      await supabaseAdmin
        .from("migz_runs")
        .update({ status: "skipped", skipped_reason: "quiet", summary: "Nothing material changed, so Migz skipped the review.", finished_at: new Date().toISOString(), cost_usd: await cost() })
        .eq("id", runId);
      await supabaseAdmin.from("agents").update({ migz_last_run_at: new Date().toISOString() }).eq("id", agent.id);
      return { runId, status: "skipped" as const };
    }
    await emit({ agentId: agent.id, runId, step: "triaging", tier: "code", summary: `Full review: ${reasons.join("; ")}`, evidence: { reasons } });
    // Optional prep (like reading new creatives' frames) must never stop the review itself
    for (const ext of extensions) {
      if (!ext.beforeReview) continue;
      try {
        await ext.beforeReview(agent, team);
      } catch (e) {
        await emit({ agentId: agent.id, runId, step: "watching", tier: "code", summary: `Skipped reading new creatives: ${e instanceof Error ? e.message.slice(0, 160) : "error"}` });
      }
    }

    const ctx = await buildEvalContext(agent, snapshot);
    // Budget changes can never take the batch's campaigns above the paced cap
    if (pacing) ctx.dailyCapCents = Math.min(ctx.dailyCapCents, pacing.dailyCapCents);
    const result = await runOperator({ agent, snapshot, runId, budget, createMessage, ctx }, extraTools, { teamContext, reasons });
    const summary = result.summary ? await writeFeed(result.summary, { agentId: agent.id, runId, budget, createMessage }) : "";

    const now = new Date().toISOString();
    await finish(runId, agent.id, { summary, model: result.executor, input_tokens: result.usage.input, output_tokens: result.usage.output, cost_usd: await cost() });
    // Remember the account as this review left it, so its own changes don't trigger the next one
    const after = await buildSnapshot(agent);
    await supabaseAdmin.from("agents").update({ migz_last_operator_at: now, migz_gate_state: gateState(after) }).eq("id", agent.id);
    await emit({ agentId: agent.id, runId, step: "finished", tier: "code", summary: summary || "Review finished", evidence: { advisor_calls: result.advisorCalls, executor: result.executor, degraded: result.degraded } });
    await notifyReviewSummary(agent, runId, summary).catch(() => {});
    return { runId, status: "succeeded" as const, summary };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await supabaseAdmin
      .from("migz_runs")
      .update({ status: "failed", error: message.slice(0, 1000), finished_at: new Date().toISOString(), cost_usd: await cost() })
      .eq("id", runId);
    // Alert first (it checks recent events to avoid repeats), then record the failure
    await alertReviewFailed(agent, message, runId).catch(() => {});
    await emit({ agentId: agent.id, runId, step: "finished", tier: "code", summary: `Review failed: ${message.slice(0, 200)}` });
    // Failed reviews don't count toward the 6-hour schedule or the 1-hour "Review now" cooldown,
    // so a fixed setup problem (bad key, missing asset) can be retried right away.
    return { runId, status: "failed" as const, error: message };
  }
}

async function finish(runId: string, agentId: string, fields: Record<string, unknown>) {
  const now = new Date().toISOString();
  await supabaseAdmin.from("migz_runs").update({ status: "succeeded", finished_at: now, ...fields }).eq("id", runId);
  await supabaseAdmin.from("agents").update({ migz_last_run_at: now }).eq("id", agentId);
}

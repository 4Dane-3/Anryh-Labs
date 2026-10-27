import "server-only";
import { supabaseAdmin } from "@/lib/supabase-admin";
import type { Agent } from "@/lib/booking/data";
import { createAd, createAdCreative, setDailyBudget, setOptimizationEvent, setPlacements, setStatus, videoState } from "@/lib/meta/ads";
import { MetaApiError } from "@/lib/meta/graph";
import { isTestMode } from "@/lib/migz/test-mode";
import { enqueueGeneration, enqueueLaunch } from "@/lib/migz/creative-jobs";
import { metaStep } from "@/lib/migz/events";
import type { ActionPayload } from "@/lib/migz/tools";
import { planTopic } from "@/lib/campaign";
import { EXPLORE } from "@/lib/batch";
import { cleanFocus } from "@/lib/migz/topics";

export type ApplyResult = { ok: true; result: Record<string, unknown> } | { ok: false; error: string };

/**
 * Carries out one validated action on Meta (or queues it) and keeps our mirror in step. Meta work runs
 * as an open Brain step (the Meta node is lit while it happens); generations open their own Higgsfield
 * step that stays lit until the creative is made.
 */
export async function applyPayload(
  agent: Agent,
  payload: ActionPayload,
  actionId: string | null,
  opts: { runId?: string | null; title?: string } = {},
): Promise<ApplyResult> {
  const now = new Date().toISOString();
  const inMeta = <T,>(work: () => Promise<T>) =>
    metaStep({ agentId: agent.id, runId: opts.runId ?? null, summary: opts.title ?? "Making a change in Meta" }, work);
  try {
    switch (payload.tool) {
      case "adjust_daily_budget": {
        await inMeta(() => setDailyBudget(payload.adset_id, payload.cents));
        await supabaseAdmin
          .from("ad_sets")
          .update({ daily_budget_cents: payload.cents, last_edited_at: now, updated_at: now })
          .eq("meta_adset_id", payload.adset_id);
        return { ok: true, result: { daily_budget_cents: payload.cents } };
      }
      case "pause_ad":
      case "resume_ad": {
        const status = payload.tool === "pause_ad" ? "PAUSED" : "ACTIVE";
        await inMeta(() => setStatus(payload.ad_id, status));
        await supabaseAdmin.from("ads").update({ status, updated_at: now }).eq("meta_ad_id", payload.ad_id);
        return { ok: true, result: { status } };
      }
      case "set_placements": {
        await inMeta(() => setPlacements(payload.adset_id, payload.placements));
        await supabaseAdmin
          .from("ad_sets")
          .update({ placements: payload.placements, last_edited_at: now, updated_at: now })
          .eq("meta_adset_id", payload.adset_id);
        return { ok: true, result: { placements: payload.placements } };
      }
      case "generate_video":
      case "generate_image":
      case "generate_carousel":
      case "new_hook_variant": {
        const jobId = await enqueueGeneration({
          agentId: agent.id,
          brief: payload.brief,
          parentCreativeId: payload.parent_creative_id,
          launchAdsetId: payload.launch_adset_id,
          actionId,
          runId: opts.runId ?? null,
        });
        return { ok: true, result: { creative_job_id: jobId } };
      }
      case "launch_creative": {
        await supabaseAdmin.from("creatives").update({ status: "in_review" }).eq("id", payload.creative_id);
        const jobId = await enqueueLaunch({
          agentId: agent.id,
          creativeId: payload.creative_id,
          launchAdsetId: payload.adset_id,
          primaryText: payload.primary_text,
          headline: payload.headline,
          actionId,
        });
        return { ok: true, result: { creative_job_id: jobId } };
      }
      case "write_copy_variants":
        return { ok: true, result: { ad_ids: await inMeta(() => launchCopyVariants(agent, payload)) } };
      case "promote_ad": {
        const adId = await inMeta(async () => {
          const { data: source } = await supabaseAdmin
            .from("ads")
            .select("id, meta_ad_id, meta_creative_id, creative_id, name, primary_text, headline")
            .eq("agent_id", agent.id)
            .eq("meta_ad_id", payload.ad_id)
            .single();
          if (!source?.meta_creative_id) throw new Error("That ad has no Meta creative to copy.");
          const id = await copyAdInto(agent, source, payload.adset_id);
          // A new ad is a significant edit: the main ad set's learning restarts from here
          await supabaseAdmin.from("ad_sets").update({ last_edited_at: now, updated_at: now }).eq("meta_adset_id", payload.adset_id);
          return id;
        });
        return { ok: true, result: { ad_id: adId } };
      }
      case "restructure": {
        const { getActiveBatch } = await import("@/lib/dashboard/batches");
        // Loaded at call time: agent.ts imports this module
        const { syncCampaignPlan } = await import("@/lib/migz/agent");
        const batch = await getActiveBatch(agent.id);
        if (!batch) throw new Error("There's no running batch to restructure.");
        const focus = cleanFocus(agent.ad_focus);
        const campaigns = [planTopic(focus) ?? "", ...(batch.campaigns.includes(EXPLORE) ? [EXPLORE] : [])];
        await supabaseAdmin.from("campaign_batches").update({ campaigns, applied_at: null }).eq("id", batch.id);
        // Rebuilds now: retires the old campaigns, makes the one campaign and carries the best ads over
        await inMeta(() => syncCampaignPlan(agent, opts.runId ?? null, { ...batch, campaigns, applied_at: null }));
        return { ok: true, result: { campaigns } };
      }
      case "set_quote_option": {
        const { error } = await supabaseAdmin.from("agents").update({ quote_mode: payload.mode }).eq("id", agent.id);
        if (error) throw new Error(`Couldn't change the quote option: ${error.message}`);
        return { ok: true, result: { quote_mode: payload.mode } };
      }
      case "set_optimization_event": {
        await inMeta(() => setOptimizationEvent(payload.adset_id, process.env.META_PIXEL_ID!, payload.event));
        await supabaseAdmin
          .from("ad_sets")
          .update({ optimization_event: payload.event, last_edited_at: now, updated_at: now })
          .eq("meta_adset_id", payload.adset_id);
        return { ok: true, result: { optimization_event: payload.event } };
      }
      case "hold":
        return { ok: true, result: {} };
    }
  } catch (e) {
    const message =
      e instanceof MetaApiError ? `Meta: ${e.userMessage ?? e.message}` : e instanceof Error ? e.message : String(e);
    return { ok: false, error: message.slice(0, 500) };
  }
}

const appUrl = () => (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");

type CopySource = { id: string; meta_ad_id: string; meta_creative_id: string | null; creative_id: string | null; name: string; primary_text: string | null; headline: string | null };

/**
 * Runs an existing ad in another ad set: a new ad on the same Meta creative (so the same media and
 * copy; it goes through Meta's review again), then the original is paused. Returns the new ad's id.
 */
export async function copyAdInto(agent: Agent, source: CopySource, targetMetaAdsetId: string) {
  const { data: target } = await supabaseAdmin.from("ad_sets").select("id").eq("agent_id", agent.id).eq("meta_adset_id", targetMetaAdsetId).single();
  if (!target || !source.meta_creative_id) throw new Error("Can't copy that ad: its creative or the target ad set is missing.");
  const held = isTestMode();
  const adId = await createAd(agent.meta_ad_account_id!, { name: source.name, adsetId: targetMetaAdsetId, creativeId: source.meta_creative_id, status: held ? "PAUSED" : "ACTIVE" });
  await supabaseAdmin.from("ads").insert({
    agent_id: agent.id,
    adset_id: target.id,
    creative_id: source.creative_id,
    meta_ad_id: adId,
    meta_creative_id: source.meta_creative_id,
    name: source.name,
    status: held ? "PAUSED" : "ACTIVE",
    held_by_test_mode: held,
    primary_text: source.primary_text,
    headline: source.headline,
  });
  await setStatus(source.meta_ad_id, "PAUSED");
  await supabaseAdmin.from("ads").update({ status: "PAUSED", updated_at: new Date().toISOString() }).eq("id", source.id);
  return adId;
}

/** New ads in the same ad set reusing the source ad's Meta media with new copy. Returns the new ad ids. */
async function launchCopyVariants(agent: Agent, payload: Extract<ActionPayload, { tool: "write_copy_variants" }>) {
  const { data: source } = await supabaseAdmin
    .from("ads")
    .select("adset_id, creative_id, name, creatives(kind, meta_video_id, meta_image_hash)")
    .eq("agent_id", agent.id)
    .eq("meta_ad_id", payload.source_ad_id)
    .single();
  const creative = source?.creatives as unknown as { kind: string; meta_video_id: string | null; meta_image_hash: string | null } | null;
  if (!source || !creative) throw new Error("The source ad is gone.");
  let media: Parameters<typeof createAdCreative>[1]["media"];
  if (creative.kind === "video" && creative.meta_video_id) {
    const state = await videoState(creative.meta_video_id);
    if (!state.thumbnail) throw new Error("Meta has no thumbnail for that video yet.");
    media = { kind: "video", videoId: creative.meta_video_id, thumbnailUrl: state.thumbnail };
  } else if (creative.meta_image_hash) {
    media = { kind: "image", imageHash: creative.meta_image_hash };
  } else throw new Error("The source creative has no Meta media to reuse.");

  const account = agent.meta_ad_account_id!;
  // Variants of a main ad launch into the exploration ad set (variantTarget), so look up where they land
  const { data: target } = await supabaseAdmin.from("ad_sets").select("id").eq("agent_id", agent.id).eq("meta_adset_id", payload.adset_id).single();
  if (!target) throw new Error("The ad set for these variants is gone.");
  const ids: string[] = [];
  for (const [i, v] of payload.variants.entries()) {
    const name = `${source.name.replace(/ · copy [A-Z]$/, "")} · copy ${String.fromCharCode(66 + i)}`.slice(0, 100);
    const metaCreativeId = await createAdCreative(account, {
      name,
      pageId: agent.meta_page_id!,
      instagramId: agent.meta_instagram_id,
      link: `${appUrl()}/${agent.slug}`,
      primaryText: v.primary_text,
      headline: v.headline,
      media,
    });
    const held = isTestMode();
    const adId = await createAd(account, { name, adsetId: payload.adset_id, creativeId: metaCreativeId, status: held ? "PAUSED" : "ACTIVE" });
    await supabaseAdmin.from("ads").insert({
      agent_id: agent.id,
      adset_id: target.id,
      creative_id: source.creative_id,
      meta_ad_id: adId,
      meta_creative_id: metaCreativeId,
      name,
      status: held ? "PAUSED" : "ACTIVE",
      held_by_test_mode: held,
      primary_text: v.primary_text,
      headline: v.headline,
    });
    ids.push(adId);
  }
  return ids;
}

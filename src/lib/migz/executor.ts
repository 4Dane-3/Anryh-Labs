import "server-only";
import { supabaseAdmin } from "@/lib/supabase-admin";
import type { Agent } from "@/lib/booking/data";
import { createAd, createAdCreative, setDailyBudget, setPlacements, setStatus, videoState } from "@/lib/meta/ads";
import { MetaApiError } from "@/lib/meta/graph";
import { enqueueGeneration, enqueueLaunch } from "@/lib/migz/creative-jobs";
import type { ActionPayload } from "@/lib/migz/tools";

export type ApplyResult = { ok: true; result: Record<string, unknown> } | { ok: false; error: string };

/** Carries out one validated action on Meta (or queues it) and keeps our mirror in step. */
export async function applyPayload(agent: Agent, payload: ActionPayload, actionId: string | null): Promise<ApplyResult> {
  const now = new Date().toISOString();
  try {
    switch (payload.tool) {
      case "adjust_daily_budget": {
        await setDailyBudget(payload.adset_id, payload.cents);
        await supabaseAdmin
          .from("ad_sets")
          .update({ daily_budget_cents: payload.cents, last_edited_at: now, updated_at: now })
          .eq("meta_adset_id", payload.adset_id);
        return { ok: true, result: { daily_budget_cents: payload.cents } };
      }
      case "pause_ad":
      case "resume_ad": {
        const status = payload.tool === "pause_ad" ? "PAUSED" : "ACTIVE";
        await setStatus(payload.ad_id, status);
        await supabaseAdmin.from("ads").update({ status, updated_at: now }).eq("meta_ad_id", payload.ad_id);
        return { ok: true, result: { status } };
      }
      case "set_placements": {
        await setPlacements(payload.adset_id, payload.placements);
        await supabaseAdmin
          .from("ad_sets")
          .update({ placements: payload.placements, last_edited_at: now, updated_at: now })
          .eq("meta_adset_id", payload.adset_id);
        return { ok: true, result: { placements: payload.placements } };
      }
      case "generate_video":
      case "generate_image":
      case "new_hook_variant": {
        const jobId = await enqueueGeneration({
          agentId: agent.id,
          brief: payload.brief,
          parentCreativeId: payload.parent_creative_id,
          launchAdsetId: payload.launch_adset_id,
          actionId,
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
        return { ok: true, result: { ad_ids: await launchCopyVariants(agent, payload) } };
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
    const adId = await createAd(account, { name, adsetId: payload.adset_id, creativeId: metaCreativeId, status: "ACTIVE" });
    await supabaseAdmin.from("ads").insert({
      agent_id: agent.id,
      adset_id: source.adset_id,
      creative_id: source.creative_id,
      meta_ad_id: adId,
      meta_creative_id: metaCreativeId,
      name,
      status: "ACTIVE",
      primary_text: v.primary_text,
      headline: v.headline,
    });
    ids.push(adId);
  }
  return ids;
}

import "server-only";
import { supabaseAdmin } from "@/lib/supabase-admin";
import type { Agent } from "@/lib/booking/data";
import { setDailyBudget, setPlacements, setStatus } from "@/lib/meta/ads";
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
      case "hold":
        return { ok: true, result: {} };
    }
  } catch (e) {
    const message =
      e instanceof MetaApiError ? `Meta: ${e.userMessage ?? e.message}` : e instanceof Error ? e.message : String(e);
    return { ok: false, error: message.slice(0, 500) };
  }
}

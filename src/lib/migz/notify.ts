import "server-only";
import { supabaseAdmin } from "@/lib/supabase-admin";
import type { Agent } from "@/lib/booking/data";
import { sendSlackMessage } from "@/lib/slack";
import { isCarouselBrief, isImageBrief, type AnyBrief } from "@/lib/migz/brief";
import {
  adLiveMessage,
  batchEndedMessage,
  batchSetupMessage,
  creativeReadyMessage,
  reviewSummaryMessage,
  type AdPreview,
  type SlackMessage,
} from "@/lib/migz/slack-blocks";

// Slack updates to the agent as Migz works: campaigns set up, ads live (with a preview of the ad), new
// creatives, what each review did and what's waiting for approval, and a batch's results. Best effort:
// a Slack problem never breaks the work it's reporting on.

const IMAGE_LINK_DAYS = 30; // Slack fetches the picture when it renders the message; the link must outlive that

const appUrl = () => (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");

type Recipient = Pick<Agent, "id" | "slug" | "full_name" | "slack_user_id">;

async function send(agent: Pick<Agent, "slack_user_id">, msg: SlackMessage | null) {
  if (!msg || !agent.slack_user_id || !process.env.SLACK_BOT_TOKEN) return false;
  try {
    await sendSlackMessage(agent.slack_user_id, msg.text, msg.blocks);
    return true;
  } catch (e) {
    console.error("slack update failed", e);
    return false;
  }
}

async function signedImage(storagePath: string) {
  const { data } = await supabaseAdmin.storage.from("creatives").createSignedUrl(storagePath, IMAGE_LINK_DAYS * 86_400);
  return data?.signedUrl ?? null;
}

/** What the ad looks like: its copy and picture(s) (stored images, or the video's thumbnail from Meta). */
async function previewFor(agent: Recipient, brief: AnyBrief, creativeIds: string[], videoThumbnail?: string | null): Promise<AdPreview> {
  const { data: rows } = await supabaseAdmin.from("creatives").select("id, storage_path, kind").in("id", creativeIds);
  const ordered = creativeIds.map((id) => rows?.find((r) => r.id === id)).filter((r): r is NonNullable<typeof r> => !!r);
  const images: AdPreview["images"] = [];
  if (videoThumbnail) images.push({ url: videoThumbnail, alt: brief.concept });
  else for (const r of ordered) if (r.kind === "image") {
    const url = await signedImage(r.storage_path);
    if (url) images.push({ url, alt: brief.concept });
  }
  return {
    pageName: agent.full_name,
    primaryText: brief.primary_text,
    headline: brief.headline,
    images,
    bookingUrl: `${appUrl()}/${agent.slug}`,
    format: isCarouselBrief(brief) ? "carousel" : isImageBrief(brief) ? "image" : "video",
  };
}

export async function notifyAdLive(
  agent: Recipient & Pick<Agent, "licensed_states">,
  input: { brief: AnyBrief; creativeIds: string[]; metaAdsetId: string; held: boolean; videoThumbnail?: string | null },
) {
  const { data: set } = await supabaseAdmin.from("ad_sets").select("ad_campaigns(name, topic)").eq("meta_adset_id", input.metaAdsetId).maybeSingle();
  const campaign = (set?.ad_campaigns as { name?: string } | null)?.name?.replace(/^Migz · /, "").replace(/ · [A-Z ]+$/, "") ?? "your";
  const ad = await previewFor(agent, input.brief, input.creativeIds, input.videoThumbnail);
  return send(agent, adLiveMessage({ ad, campaign, states: agent.licensed_states, held: input.held, dashboardUrl: appUrl() }));
}

export async function notifyCreativeReady(agent: Recipient, input: { brief: AnyBrief; creativeIds: string[] }) {
  const ad = await previewFor(agent, input.brief, input.creativeIds);
  return send(agent, creativeReadyMessage({ ad, dashboardUrl: appUrl() }));
}

export async function notifyBatchSetup(
  agent: Recipient & Pick<Agent, "licensed_states" | "migz_mode">,
  input: { budgetCents: number | null; days: number | null; campaigns: string[]; perCampaignCents: number; endsOn: string | null },
) {
  return send(agent, batchSetupMessage({ ...input, states: agent.licensed_states, auto: agent.migz_mode === "auto", dashboardUrl: appUrl() }));
}

/** After a review: what it changed and what's waiting for approval (nothing is sent for a review that did nothing). */
export async function notifyReviewSummary(agent: Recipient, runId: string, summary: string) {
  const { data } = await supabaseAdmin.from("ad_actions").select("title, detail, status, tool").eq("agent_id", agent.id).eq("run_id", runId).order("created_at");
  const rows = data ?? [];
  // The system's own bookkeeping (setup, pacing, test-mode switches) gets its own messages or isn't news
  const mine = rows.filter((r) => !String(r.tool ?? "").startsWith("system_"));
  return send(
    agent,
    reviewSummaryMessage({
      summary,
      applied: mine.filter((r) => r.status === "applied").map((r) => r.title),
      proposed: mine.filter((r) => r.status === "proposed").map((r) => ({ title: r.title, detail: r.detail })),
      dashboardUrl: appUrl(),
    }),
  );
}

export async function notifyBatchEnded(agent: Recipient, input: { budgetCents: number; spentCents: number; bookedCalls: number }) {
  return send(agent, batchEndedMessage({ ...input, dashboardUrl: appUrl() }));
}

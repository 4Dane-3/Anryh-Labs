import "server-only";
import { supabaseAdmin } from "@/lib/supabase-admin";
import type { Agent } from "@/lib/booking/data";
import { sendSlackMessage } from "@/lib/slack";
import { isCarouselBrief, isImageBrief, type AnyBrief } from "@/lib/migz/brief";
import { graphAll } from "@/lib/meta/graph";
import {
  adLiveMessage,
  adsReviewedMessage,
  nightlySummaryMessage,
  type NightlyContent,
  researchIdeaMessage,
  batchEndedMessage,
  batchSetupMessage,
  creativeReadyMessage,
  reviewSummaryMessage,
  type AdPreview,
  type SlackMessage,
} from "@/lib/migz/slack-blocks";

// Slack updates to the agent as Migz works: campaigns set up, ads sent to Meta and then approved (with a
// preview of the ad), new
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
  input: { budgetCents: number | null; days: number | null; campaigns: string[]; perCampaignCents: number; campaignCents?: number[]; endsOn: string | null },
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

// Meta's review: "approved" once the ad is delivering; a rejection carries Meta's reason. Ads still in
// review (or paused, which Meta's status can't tell apart) are checked again next time.
const REVIEW_WINDOW_DAYS = 7; // past this, an ad's review is old news
const APPROVED = new Set(["ACTIVE"]);
const REJECTED = new Set(["DISAPPROVED"]);

type MetaAdReview = {
  id: string;
  effective_status: string;
  ad_review_feedback?: { global?: Record<string, string> };
  creative?: { thumbnail_url?: string; image_url?: string };
};

/**
 * Every 10 minutes (creatives cron): tells each agent once, in one message, which of their new ads Meta
 * finished reviewing. Before the review_notified_at migration runs, this does nothing.
 */
export async function notifyAdReviews(deadlineMs: number) {
  const since = new Date(Date.now() - REVIEW_WINDOW_DAYS * 86_400_000).toISOString();
  const { data: rows, error } = await supabaseAdmin
    .from("ads")
    .select("id, agent_id, meta_ad_id, headline, primary_text, creative_id, status, creatives(kind, storage_path), ad_sets(ad_campaigns(name))")
    .is("review_notified_at", null)
    .gte("created_at", since)
    .eq("status", "ACTIVE")
    .limit(100);
  if (error || !rows?.length) return {};

  const byAgent = new Map<string, typeof rows>();
  for (const r of rows) byAgent.set(r.agent_id, [...(byAgent.get(r.agent_id) ?? []), r]);
  const results: Record<string, string> = {};

  for (const [agentId, ads] of byAgent) {
    if (Date.now() > deadlineMs) break;
    const { data: agent } = await supabaseAdmin.from("agents").select("id, slug, full_name, slack_user_id, licensed_states, meta_ad_account_id").eq("id", agentId).single();
    if (!agent?.meta_ad_account_id) continue;
    let reviews: Record<string, MetaAdReview>;
    try {
      const list = await graphAll<MetaAdReview>(`${agent.meta_ad_account_id}/ads`, {
        fields: "id,effective_status,ad_review_feedback,creative{thumbnail_url,image_url}",
        filtering: JSON.stringify([{ field: "id", operator: "IN", value: ads.map((a) => a.meta_ad_id) }]),
        limit: 100,
      });
      reviews = Object.fromEntries(list.map((r) => [r.id, r]));
    } catch (e) {
      console.error("ad review check failed", agent.slug, e instanceof Error ? e.message : e);
      continue;
    }

    const approved: Parameters<typeof adsReviewedMessage>[0]["approved"] = [];
    const rejected: Parameters<typeof adsReviewedMessage>[0]["rejected"] = [];
    const done: string[] = [];
    for (const a of ads) {
      const review = reviews[a.meta_ad_id];
      if (!review || (!APPROVED.has(review.effective_status) && !REJECTED.has(review.effective_status))) continue;
      const creative = a.creatives as { kind?: string; storage_path?: string } | null;
      // Our stored picture for image ads (Meta's thumbnail is small); Meta's frame for videos
      const stored = creative?.kind === "image" && creative.storage_path ? await signedImage(creative.storage_path) : null;
      const picture = stored ?? review.creative?.thumbnail_url ?? review.creative?.image_url ?? null;
      const campaign = ((a.ad_sets as { ad_campaigns?: { name?: string } } | null)?.ad_campaigns?.name ?? "your").replace(/^Migz · /, "").replace(/ · [A-Z ]+$/, "");
      const ad: AdPreview = {
        pageName: agent.full_name,
        primaryText: a.primary_text ?? "",
        headline: a.headline ?? "Your ad",
        images: picture ? [{ url: picture, alt: a.headline ?? "Ad" }] : [],
        bookingUrl: `${appUrl()}/${agent.slug}`,
        format: creative?.kind === "video" ? "video" : "image",
      };
      if (APPROVED.has(review.effective_status)) approved.push({ ad, campaign });
      else rejected.push({ ad, campaign, reason: Object.values(review.ad_review_feedback?.global ?? {})[0] ?? null });
      done.push(a.id);
    }
    if (!done.length) continue;
    // Marked even when the agent has no Slack, so connecting Slack later doesn't replay old reviews
    await supabaseAdmin.from("ads").update({ review_notified_at: new Date().toISOString() }).in("id", done);
    const sent = await send(agent, adsReviewedMessage({ approved, rejected, states: agent.licensed_states, dashboardUrl: appUrl() }));
    results[agent.slug] = `${approved.length} approved, ${rejected.length} not approved${sent ? "" : " (not sent: no Slack)"}`;
  }
  return results;
}

/** The research shift drafted an idea worth sharing (the caller caps how many go out a day). */
export async function notifyResearch(agent: Pick<Agent, "slack_user_id">, input: Omit<Parameters<typeof researchIdeaMessage>[0], "dashboardUrl">) {
  return send(agent, researchIdeaMessage({ ...input, dashboardUrl: appUrl() }));
}

/** The 9pm summary of the agent's day (sent by the nightly shift). */
export async function notifyNightly(agent: Pick<Agent, "slack_user_id">, content: NightlyContent) {
  return send(agent, nightlySummaryMessage({ ...content, dashboardUrl: appUrl() }));
}

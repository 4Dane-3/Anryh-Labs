import "server-only";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { landingUrl } from "@/lib/booking/sites";
import type { Agent } from "@/lib/booking/data";
import { sendSlackMessage } from "@/lib/slack";
import { graphAll } from "@/lib/meta/graph";
import {
  adsReviewedMessage,
  nightlySummaryMessage,
  type NightlyContent,
  batchEndedMessage,
  batchRenewBlockedMessage,
  batchRenewedMessage,
  type AdPreview,
  type SlackMessage,
} from "@/lib/migz/slack-blocks";

// Slack to the agent is kept quiet: the summary every SUMMARY_EVERY_DAYS days (notifyNightly) carries what
// Migz did; beyond it only what needs the agent or moves their money (an ad Meta rejected, a batch ending
// or renewing). Ads going live, approvals, new creatives and each review show in the dashboard instead.
// Best effort: a Slack problem never breaks the work it's reporting on.

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

export async function notifyBatchRenewed(agent: Recipient, input: { budgetCents: number; days: number; dailyCents: number; balanceCents: number }) {
  return send(agent, batchRenewedMessage({ ...input, dashboardUrl: appUrl() }));
}

export async function notifyBatchRenewBlocked(agent: Recipient, input: { reason: string; stopped: boolean }) {
  return send(agent, batchRenewBlockedMessage({ ...input, dashboardUrl: appUrl() }));
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
 * Every 10 minutes (creatives cron): records which of each agent's new ads Meta finished reviewing, and
 * tells the agent once, in one message, about any it rejected. Before the review_notified_at migration runs, this does nothing.
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

    const rejected: Parameters<typeof adsReviewedMessage>[0]["rejected"] = [];
    const done: string[] = [];
    for (const a of ads) {
      const review = reviews[a.meta_ad_id];
      if (!review || (!APPROVED.has(review.effective_status) && !REJECTED.has(review.effective_status))) continue;
      done.push(a.id);
      if (APPROVED.has(review.effective_status)) continue;
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
        bookingUrl: landingUrl(agent.slug, appUrl()),
        format: creative?.kind === "video" ? "video" : "image",
      };
      rejected.push({ ad, campaign, reason: Object.values(review.ad_review_feedback?.global ?? {})[0] ?? null });
    }
    if (!done.length) continue;
    // Marked even when the agent has no Slack, so connecting Slack later doesn't replay old reviews
    await supabaseAdmin.from("ads").update({ review_notified_at: new Date().toISOString() }).in("id", done);
    // Approvals aren't news (the summary covers what's live); only a rejection needs the agent
    const sent = rejected.length ? await send(agent, adsReviewedMessage({ approved: [], rejected, states: agent.licensed_states, dashboardUrl: appUrl() })) : false;
    results[agent.slug] = `${done.length - rejected.length} approved, ${rejected.length} not approved${rejected.length && !sent ? " (not sent: no Slack)" : ""}`;
  }
  return results;
}

/** The 9pm summary of the last few days (sent by the nightly shift every SUMMARY_EVERY_DAYS days). */
export async function notifyNightly(agent: Pick<Agent, "slack_user_id">, content: NightlyContent) {
  return send(agent, nightlySummaryMessage({ ...content, dashboardUrl: appUrl() }));
}

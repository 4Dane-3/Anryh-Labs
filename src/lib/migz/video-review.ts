import "server-only";
import { supabaseAdmin } from "@/lib/supabase-admin";
import type { Agent } from "@/lib/booking/data";
import { sendSlackMessage } from "@/lib/slack";
import { recordEventAlert } from "@/lib/admin/alerts";
import { alertAdmin } from "@/lib/migz/slack";
import { esc } from "@/lib/migz/slack-blocks";
import { briefLabel, type AnyBrief, type CreativeBrief } from "@/lib/migz/brief";
import { advanceJobById, enqueueGeneration, refundVideo } from "@/lib/migz/creative-jobs";
import { sendSms, smsReady } from "@/lib/migz/sms";
import { reviseBrief } from "@/lib/migz/video-revise";
import { MAX_REVISIONS } from "@/lib/migz/video-review-copy";
import { verticalOf } from "@/lib/verticals";
import { reviewEmail, reviewLine, reviewSlack, shouldAsk, shouldNudge, type WaitingVideo } from "@/lib/migz/video-review-copy";

// Video approvals: a video Migz made waits at "awaiting_approval" until the agent approves it on their
// private review page (/review/<token>). The cron asks by email and Slack, once per batch, and reminds once.
// Links only ever open the page: approving takes a press on it (a POST), so link scanners can't approve.
//
// Outside production nothing reaches a real agent: the message is logged, or the email goes to
// CRM_EMAIL_TEST_TO. Set CRM_EMAIL_LIVE=1 to send for real in dev.

const appUrl = () => (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");
const reviewUrl = (token: string) => `${appUrl()}/review/${token}`;
const isLive = () => process.env.NODE_ENV === "production" || process.env.CRM_EMAIL_LIVE === "1";

type Row = WaitingVideo & { id: string; agent_id: string };

async function emailAgent(agent: Pick<Agent, "id" | "email" | "full_name">, input: { count: number; url: string; nudge: boolean; key: string }) {
  const email = reviewEmail({ name: agent.full_name, ...input });
  const testTo = process.env.CRM_EMAIL_TEST_TO?.trim();
  if (!isLive() && !testTo) {
    console.info(`[video review email: logged, not sent] → ${agent.email}\n  Subject: ${email.subject}\n${email.text.replace(/^/gm, "  | ")}`);
    return true;
  }
  if (!process.env.RESEND_API_KEY || !process.env.BOOKING_EMAIL_FROM) return false;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Idempotency-Key": `video-review/${input.key}` },
    body: JSON.stringify({ from: `Migz AI <${process.env.BOOKING_EMAIL_FROM}>`, to: [isLive() ? agent.email : testTo], subject: email.subject, html: email.html, text: email.text }),
  });
  if (!res.ok) console.error("video review email failed", res.status, (await res.text()).slice(0, 300));
  return res.ok;
}

async function slackAgent(agent: Pick<Agent, "slack_user_id">, input: { count: number; url: string; nudge: boolean }) {
  if (!agent.slack_user_id || !process.env.SLACK_BOT_TOKEN || !isLive()) return false;
  const msg = reviewSlack(input);
  try {
    await sendSlackMessage(agent.slack_user_id, msg.text, msg.blocks);
    return true;
  } catch (e) {
    console.error("video review slack failed", e);
    return false;
  }
}

async function tell(agent: Agent, count: number, nudge: boolean, key: string) {
  const input = { count, url: reviewUrl(agent.video_review_token!), nudge };
  const [emailed, slacked, texted] = await Promise.all([
    emailAgent(agent, { ...input, key }).catch(() => false),
    slackAgent(agent, input),
    agent.sms_opt_in_at && agent.sms_phone && smsReady() && isLive()
      ? sendSms(agent.sms_phone, `${reviewLine(count, nudge)} ${input.url} Reply APPROVE to approve ${count === 1 ? "it" : "them all"}.`).then(() => true).catch((e) => (console.error("video review text failed", e), false))
      : Promise.resolve(false),
  ]);
  return emailed || slacked || texted;
}

/** The cron's part: asks about new videos (one message per batch) and reminds once about old ones. */
export async function sendVideoReviewRequests() {
  const { data, error } = await supabaseAdmin
    .from("creative_jobs")
    .select("id, agent_id, approval_ready_at, approval_requested_at, approval_nudged_at")
    .eq("stage", "awaiting_approval")
    .limit(500);
  if (error) return { skipped: "migration not run" };
  const rows = (data ?? []) as Row[];
  const byAgent = new Map<string, Row[]>();
  for (const r of rows) byAgent.set(r.agent_id, [...(byAgent.get(r.agent_id) ?? []), r]);

  const now = Date.now();
  let asked = 0;
  let nudged = 0;
  for (const [agentId, videos] of byAgent) {
    const [{ data: agent }, { count: making }] = await Promise.all([
      supabaseAdmin.from("agents").select("*").eq("id", agentId).maybeSingle(),
      supabaseAdmin.from("creative_jobs").select("id", { count: "exact", head: true }).eq("agent_id", agentId).eq("stage", "generating").not("launch_adset_id", "is", null),
    ]);
    if (!agent?.video_review_token) continue;

    if (shouldAsk(videos, (making ?? 0) > 0, now)) {
      // Claim first, so overlapping runs can't send twice; given back if nothing could be sent
      const stamp = new Date(now).toISOString();
      const { data: claimed } = await supabaseAdmin
        .from("creative_jobs")
        .update({ approval_requested_at: stamp })
        .in("id", videos.filter((v) => !v.approval_requested_at).map((v) => v.id))
        .is("approval_requested_at", null)
        .select("id");
      const ids = (claimed ?? []).map((c) => c.id as string);
      if (ids.length) {
        if (await tell(agent as Agent, ids.length, false, `${agentId}/${ids[0]}/ask`)) asked++;
        else {
          await supabaseAdmin.from("creative_jobs").update({ approval_requested_at: null }).in("id", ids);
          await recordEventAlert({ agentId, key: `video_review_unsent:${ids[0]}`, severity: "warn", title: "Video approval not sent", detail: "Couldn't email or Slack this agent about videos waiting for approval." });
        }
      }
      continue;
    }

    if (shouldNudge(videos, now)) {
      const stamp = new Date(now).toISOString();
      const { data: claimed } = await supabaseAdmin
        .from("creative_jobs")
        .update({ approval_nudged_at: stamp })
        .in("id", videos.map((v) => v.id))
        .is("approval_nudged_at", null)
        .select("id");
      if (claimed?.length && (await tell(agent as Agent, videos.length, true, `${agentId}/${claimed[0].id}/nudge`))) nudged++;
    }
  }
  return { waiting: rows.length, asked, nudged };
}

export type ReviewVideo = { id: string; label: string; url: string | null; headline: string; primaryText: string; voiceover: string | null };

export async function agentByReviewToken(token: string) {
  if (!/^[0-9a-f]{64}$/.test(token)) return null;
  const { data } = await supabaseAdmin.from("agents").select("id, slug, full_name, video_review_token").eq("video_review_token", token).maybeSingle();
  return data as Pick<Agent, "id" | "slug" | "full_name"> | null;
}

/** Everything waiting for this agent, with short-lived links to play it. */
export async function videosToReview(agentId: string): Promise<ReviewVideo[]> {
  const { data: jobs } = await supabaseAdmin
    .from("creative_jobs")
    .select("id, brief, creative_id")
    .eq("agent_id", agentId)
    .eq("stage", "awaiting_approval")
    .order("approval_ready_at");
  const list = jobs ?? [];
  const ids = list.map((j) => j.creative_id).filter((id): id is string => !!id);
  const { data: creatives } = ids.length ? await supabaseAdmin.from("creatives").select("id, storage_path").in("id", ids) : { data: [] };
  const pathById = new Map((creatives ?? []).map((c) => [c.id as string, c.storage_path as string]));
  const paths = [...pathById.values()];
  const { data: signed } = paths.length ? await supabaseAdmin.storage.from("creatives").createSignedUrls(paths, 6 * 3600) : { data: [] };
  const urlByPath = new Map((signed ?? []).map((s) => [s.path, s.signedUrl]));
  return list.map((j) => {
    const brief = j.brief as AnyBrief & { voiceover?: string | null };
    return { id: j.id, label: briefLabel(brief), url: urlByPath.get(pathById.get(j.creative_id) ?? "") ?? null, headline: brief.headline, primaryText: brief.primary_text, voiceover: brief.voiceover ?? null };
  });
}

/** Lets approved videos on their way to Meta. Returns how many this call approved. */
export async function approveVideos(agentId: string, jobIds: string[]) {
  if (!jobIds.length) return 0;
  const { data } = await supabaseAdmin
    .from("creative_jobs")
    .update({ stage: "stored", approval_status: "approved", approval_decided_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("agent_id", agentId)
    .eq("stage", "awaiting_approval")
    .in("id", jobIds)
    .select("id");
  // Best effort: if this doesn't finish, the next cron run picks them up
  await Promise.allSettled((data ?? []).map((j) => advanceJobById(j.id as string)));
  return data?.length ?? 0;
}

/**
 * The agent wants something changed: this video never goes live and its charge comes back (they only pay
 * for a video that runs). Migz remakes it from the note and asks again, up to MAX_REVISIONS times; after that,
 * or if the remake can't start, staff get the note.
 */
export async function requestVideoChanges(agent: { id: string; slug: string }, jobId: string, note: string): Promise<"remaking" | "staff" | false> {
  const clean = note.trim().slice(0, 1000);
  const now = new Date().toISOString();
  const { data } = await supabaseAdmin
    .from("creative_jobs")
    .update({ stage: "failed", approval_status: "changes_requested", approval_note: clean, approval_decided_at: now, error: `Changes requested: ${clean}`.slice(0, 500), updated_at: now })
    .eq("agent_id", agent.id)
    .eq("id", jobId)
    .eq("stage", "awaiting_approval")
    .select("id, brief, creative_id, launch_adset_id, revision_count")
    .maybeSingle();
  if (!data) return false;
  if (data.creative_id) await supabaseAdmin.from("creatives").update({ status: "rejected", review_note: `Changes requested: ${clean}`.slice(0, 200) }).eq("id", data.creative_id);
  await refundVideo(jobId, "Refund: you asked for changes to this video").catch((e) => console.error("refunding the video failed", e));
  const count = (data.revision_count as number | null) ?? 0;
  if (count < MAX_REVISIONS) {
    try {
      const { data: owner } = await supabaseAdmin.from("agents").select("vertical").eq("id", agent.id).single();
      const brief = await reviseBrief(data.brief as CreativeBrief, clean, { agentId: agent.id, vertical: verticalOf(owner) });
      await enqueueGeneration({ agentId: agent.id, brief, launchAdsetId: data.launch_adset_id as string | null, revisionCount: count + 1 });
      return "remaking";
    } catch (e) {
      console.error("video remake failed", e);
    }
  }
  await alertAdmin(`*Video changes need a person* for \`${agent.slug}\` on "${esc(briefLabel(data.brief as AnyBrief)).slice(0, 120)}"\n>${esc(clean)}`).catch(() => {});
  return "staff";
}

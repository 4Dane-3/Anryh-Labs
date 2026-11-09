import "server-only";
import { randomUUID } from "node:crypto";
import { DateTime } from "luxon";
import { supabaseAdmin } from "@/lib/supabase-admin";
import type { Agent } from "@/lib/booking/data";
import { ROOFING_ADDRESS_KEY, type IntakeAnswers } from "@/lib/booking/questions";
import { logActivity } from "@/lib/dashboard/activity";
import { sendSlackMessage } from "@/lib/slack";
import { resend } from "@/lib/roofing/notify";
import { issueAlertEmail, referralInviteEmail } from "@/lib/roofing/referral-emails";
import { checkinConfigured, placeOutboundCall, voiceConfig } from "@/lib/voice/elevenlabs";
import { isDoNotCall } from "@/lib/voice/dial";
import { inCallWindow } from "@/lib/voice/rules";
import { CHECKIN_MAX_ATTEMPTS, checkinOutcome, checkinRetryAt, checkinTime, checkinVariables, planCheckin, ratingOf, type CheckinOutcome } from "@/lib/voice/checkin-rules";

// The post-job check-in. The roofer marks a job done (dashboard or CRM webhook); about 2 hours later the
// check-in agent ("Hi, this is Emma, the virtual assistant for …") calls the customer, if their consent covers
// AI calls. It asks how it went, gets a 1–5 rating and their best email. Went well: the send_referral tool emails
// them their referral link mid-call. A problem: report_issue alerts the roofer right away, and no referral pitch.
// No consent (or calls off, or do-not-call): the referral email goes on its own, worded for no call.

const appUrl = () => (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");
export const referralUrl = (token: string) => `${appUrl()}/r/${token}`;

type JobRow = {
  id: string;
  agent_id: string;
  name: string;
  email: string | null;
  phone: string;
  starts_at: string;
  status: string;
  consent_text: string;
  job_done_at: string | null;
  checkin_status: string | null;
  checkin_attempts: number;
  checkin_rating: number | null;
  checkin_alerted_at: string | null;
  referral_token: string | null;
  referral_email_sent_at: string | null;
  intake_responses: { answers: IntakeAnswers } | { answers: IntakeAnswers }[] | null;
};

const JOB_FIELDS =
  "id, agent_id, name, email, phone, starts_at, status, consent_text, job_done_at, checkin_status, checkin_attempts, checkin_rating, checkin_alerted_at, referral_token, referral_email_sent_at, intake_responses(answers)";

const addressOf = (job: JobRow) => {
  const intake = Array.isArray(job.intake_responses) ? job.intake_responses[0] : job.intake_responses;
  return intake?.answers?.[ROOFING_ADDRESS_KEY]?.value?.trim() || null;
};

async function getJob(id: unknown): Promise<(JobRow & { agents: Agent }) | null> {
  if (typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id)) return null;
  const { data } = await supabaseAdmin.from("bookings").select(`${JOB_FIELDS}, agents(*)`).eq("id", id).maybeSingle();
  return (data as unknown as JobRow & { agents: Agent }) ?? null;
}

export type JobDoneResult =
  | { ok: true; already: boolean; status: "scheduled" | "email_only"; callAt: string | null; reason: string | null }
  | { ok: false; status: number; error: string };

/** The roofer finished the job: schedule the check-in call, or send the referral email when there'll be no call. */
export async function markJobDone(agent: Agent, bookingId: string, via: "dashboard" | "webhook"): Promise<JobDoneResult> {
  const { data } = await supabaseAdmin.from("bookings").select(JOB_FIELDS).eq("id", bookingId).eq("agent_id", agent.id).maybeSingle();
  const job = data as unknown as JobRow | null;
  if (!job) return { ok: false, status: 404, error: "No such inspection." };
  if (job.status !== "confirmed") return { ok: false, status: 409, error: "That inspection was cancelled." };
  if (job.job_done_at) return { ok: true, already: true, status: job.checkin_status === "email_only" ? "email_only" : "scheduled", callAt: null, reason: null };

  const now = new Date();
  const plan = planCheckin({
    callsOn: !!agent.checkin_calls,
    configured: checkinConfigured(),
    consentText: job.consent_text,
    phone: job.phone,
    doNotCall: await isDoNotCall(job.phone),
    tz: agent.timezone, // the customer's home is in the roofer's area
    doneAt: now,
  });
  const token = job.referral_token ?? randomUUID();
  const { data: claimed, error } = await supabaseAdmin
    .from("bookings")
    .update({
      job_done_at: now.toISOString(),
      referral_token: token,
      checkin_status: plan.kind === "call" ? "scheduled" : "email_only",
      checkin_next_call_at: plan.kind === "call" ? plan.at.toISOString() : null,
      // A finished job is a sale: the client is a current customer now
      client_status: "current",
    })
    .eq("id", job.id)
    .is("job_done_at", null) // marked twice at once (button + webhook): only one wins
    .select("id")
    .maybeSingle();
  if (error) return { ok: false, status: 500, error: error.code === "42703" ? "Check-in calls aren't set up yet (migration)." : "Couldn't save that." };
  if (!claimed) return { ok: true, already: true, status: "scheduled", callAt: null, reason: null };

  const when = plan.kind === "call" ? DateTime.fromJSDate(plan.at).setZone(agent.timezone).toFormat("ccc h:mm a") : null;
  await logActivity(
    agent.id,
    { kind: "call", id: job.id },
    "note",
    plan.kind === "call"
      ? `Job marked done${via === "webhook" ? " (from your CRM)" : ""}. Your AI assistant will call to check in ${when}.`
      : `Job marked done${via === "webhook" ? " (from your CRM)" : ""}. No check-in call (${plan.reason}); ${job.email ? "the referral email went instead" : "and no email on file, so nothing was sent"}.`,
  );
  if (plan.kind === "email_only" && job.email) await sendReferralInvite(agent, { ...job, referral_token: token }, "no_call").catch((e) => console.error("[checkin] referral email failed", e));
  return { ok: true, already: false, status: plan.kind === "call" ? "scheduled" : "email_only", callAt: plan.kind === "call" ? plan.at.toISOString() : null, reason: plan.kind === "email_only" ? plan.reason : null };
}

/** Emails the customer their referral link, once per job. Returns whether it went (or would, without Resend). */
export async function sendReferralInvite(agent: Agent, job: Pick<JobRow, "id" | "name" | "email" | "referral_token">, variant: "after_call" | "no_call") {
  if (!job.email || !job.referral_token) return { sent: false, reason: "no email" };
  const { data: claim } = await supabaseAdmin.from("bookings").update({ referral_email_sent_at: new Date().toISOString() }).eq("id", job.id).is("referral_email_sent_at", null).select("id").maybeSingle();
  if (!claim) return { sent: true, reason: "already sent" };
  const email = referralInviteEmail({
    company: agent.full_name,
    customerName: job.name,
    link: referralUrl(job.referral_token),
    rewardCents: agent.referral_reward_cents ?? 10000,
    goal: agent.referral_goal ?? 5,
    reviewUrl: agent.google_review_url || null,
    variant,
  });
  try {
    const res = await resend(
      { from: `${agent.full_name.replace(/[<>"]/g, "")} <${process.env.BOOKING_EMAIL_FROM}>`, to: [job.email], reply_to: agent.business_email || agent.email, subject: email.subject, html: email.html, text: email.text },
      `referral-invite/${job.id}`,
    );
    if (res.skipped) console.log(`[checkin] referral email to ${job.email} (Resend not set up, not sent): ${email.subject} · ${referralUrl(job.referral_token)}`);
    await logActivity(agent.id, { kind: "call", id: job.id }, "email", `Referral email sent to ${job.email}.`);
    return { sent: true, reason: null };
  } catch (e) {
    await supabaseAdmin.from("bookings").update({ referral_email_sent_at: null }).eq("id", job.id); // let a retry send it
    throw e;
  }
}

/** Tells the roofer right away (email, and Slack when connected) that a customer raised a problem. Once per job. */
export async function alertRooferIssue(agent: Agent, job: JobRow, details: string, rating: number | null) {
  const { data: claim } = await supabaseAdmin.from("bookings").update({ checkin_alerted_at: new Date().toISOString(), checkin_feedback: details.slice(0, 2000) || null }).eq("id", job.id).is("checkin_alerted_at", null).select("id").maybeSingle();
  if (!claim) return;
  const email = issueAlertEmail({
    customerName: job.name,
    phone: job.phone,
    address: addressOf(job),
    rating,
    details,
    jobDate: DateTime.fromISO(job.starts_at).setZone(agent.timezone).toFormat("LLL d"),
  });
  await resend({ to: [agent.business_email || agent.email], subject: email.subject, html: email.html, text: email.text }, `checkin-issue/${job.id}`).catch((e) => console.error("[checkin] issue email failed", e));
  if (agent.slack_user_id)
    await sendSlackMessage(agent.slack_user_id, `:warning: *${job.name}* raised a problem on the check-in call${rating ? ` (${rating}/5)` : ""}: ${details || "see the call summary"}. Call them back: ${job.phone}. ${appUrl()}/dashboard/clients?id=call:${job.id}`).catch((e) =>
      console.error("[checkin] issue slack failed", e),
    );
  await logActivity(agent.id, { kind: "call", id: job.id }, "note", `Check-in: they raised a problem${rating ? ` (${rating}/5)` : ""}. ${details}`.trim());
}

// ---------- Placing the call ----------

async function dialCheckin(agent: Agent, job: JobRow, attempt: number) {
  const requestedAt = new Date();
  const result = await placeOutboundCall(job.phone, checkinVariables({ id: job.id, name: job.name, email: job.email, address: addressOf(job) }, agent), { agentId: voiceConfig().checkinAgentId });
  const returnedAt = new Date();
  console.log(`[checkin] job ${job.id} attempt ${attempt}: API ${returnedAt.getTime() - requestedAt.getTime()}ms${result.ok ? (result.simulated ? " (simulated)" : "") : ` FAILED: ${result.error}`}`);
  const { error } = await supabaseAdmin.from("voice_calls").insert({
    kind: "checkin",
    job_booking_id: job.id,
    agent_id: agent.id,
    attempt,
    reason: attempt === 1 ? "checkin" : "retry",
    to_number: job.phone,
    requested_at: requestedAt.toISOString(),
    api_returned_at: returnedAt.toISOString(),
    conversation_id: result.ok ? result.conversationId : null,
    call_sid: result.ok ? result.callSid : null,
    status: result.ok ? "dialing" : "failed_to_start",
    failure_reason: result.ok ? null : result.error.slice(0, 500),
  });
  if (error) console.error("[checkin] saving the call failed", error);
  await supabaseAdmin.from("bookings").update({ checkin_status: result.ok ? "calling" : "failed", checkin_attempts: attempt, checkin_next_call_at: null }).eq("id", job.id);
  // A call that never started: the email still goes, so the customer hears from us either way
  if (!result.ok && job.email) await sendReferralInvite(agent, job, "no_call").catch(() => {});
  return result;
}

/** Check-in calls that are due, claimed so two cron runs never call twice. Rechecks consent, toggle and the clock. */
export async function placeDueCheckins(limit = 20) {
  const { data: due, error } = await supabaseAdmin.from("bookings").select("id").eq("checkin_status", "scheduled").lte("checkin_next_call_at", new Date().toISOString()).order("checkin_next_call_at").limit(limit);
  if (error) return 0; // before the migration
  let placed = 0;
  for (const { id } of due ?? []) {
    const { data } = await supabaseAdmin.from("bookings").update({ checkin_status: "calling" }).eq("id", id).eq("checkin_status", "scheduled").select(`${JOB_FIELDS}, agents(*)`).maybeSingle();
    const job = data as unknown as (JobRow & { agents: Agent }) | null;
    if (!job) continue;
    const agent = job.agents;
    const plan = planCheckin({ callsOn: !!agent.checkin_calls, configured: checkinConfigured(), consentText: job.consent_text, phone: job.phone, doNotCall: await isDoNotCall(job.phone), tz: agent.timezone });
    if (plan.kind === "email_only") {
      // Things changed since the job was marked done (calls turned off, they asked not to be called)
      await supabaseAdmin.from("bookings").update({ checkin_status: "email_only", checkin_next_call_at: null }).eq("id", id);
      if (job.email && job.checkin_attempts === 0) await sendReferralInvite(agent, job, "no_call").catch(() => {});
      continue;
    }
    if (!inCallWindow(agent.timezone)) {
      await supabaseAdmin.from("bookings").update({ checkin_status: "scheduled", checkin_next_call_at: checkinTime(agent.timezone, new Date(Date.now() - 2 * 60 * 60_000)).toISOString() }).eq("id", id);
      continue;
    }
    await dialCheckin(agent, job, (job.checkin_attempts ?? 0) + 1);
    placed++;
  }
  return placed;
}

// ---------- The check-in agent's tools ----------

const str = (v: unknown, max = 300) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** send_referral: { job_id, email?, name?, rating? } → emails the referral link now, during the call. */
export async function sendReferralTool(body: Record<string, unknown>) {
  const job = await getJob(body.job_id);
  if (!job) return { error: "Unknown job." };
  const agent = job.agents;
  const email = str(body.email, 200).toLowerCase();
  const name = str(body.name, 100);
  const rating = ratingOf(body.rating);
  const update: Record<string, unknown> = {};
  if (EMAIL.test(email) && email !== job.email) update.email = email;
  if (name && name !== job.name) update.name = name;
  if (rating) update.checkin_rating = rating;
  if (Object.keys(update).length) await supabaseAdmin.from("bookings").update(update).eq("id", job.id);
  const to = (update.email as string | undefined) ?? job.email;
  if (!to) return { error: "Ask for their email address first, then call send_referral again with it." };
  if (!job.referral_token) return { error: "The referral link isn't ready. Tell them the team will email it shortly." };
  try {
    await sendReferralInvite(agent, { ...job, email: to, name: (update.name as string | undefined) ?? job.name }, "after_call");
  } catch {
    return { error: "The email didn't go. Tell them the team will send it shortly." };
  }
  const reward = checkinVariables({ id: job.id, name: job.name, email: to, address: null }, agent);
  const review = agent.google_review_url ? "a link to leave us a Google review, and " : "";
  const referral = reward.reward
    ? `a link where, if they refer ${reward.referral_goal} friends who may need roofing work, ${agent.full_name} will send them ${reward.reward} to any store they choose`
    : "a link to refer friends who may need roofing work";
  return {
    sent: true,
    email: to,
    message: `Sent to ${to}. Now tell them, in your own words: you just emailed them ${review}${referral}. The gift card is for referrals only; never connect it to the review. Don't ask for a particular rating. Then thank them and end the call.`,
  };
}

/** report_issue: { job_id, details, rating? } → alerts the roofer right away. No referral offer after this. */
export async function reportIssueTool(body: Record<string, unknown>) {
  const job = await getJob(body.job_id);
  if (!job) return { error: "Unknown job." };
  const rating = ratingOf(body.rating);
  await supabaseAdmin.from("bookings").update({ checkin_status: "issue", ...(rating ? { checkin_rating: rating } : {}) }).eq("id", job.id);
  await alertRooferIssue(job.agents, job, str(body.details, 1000), rating ?? job.checkin_rating);
  return { ok: true, message: `${job.agents.full_name} has been told and will call them. Apologize, say someone will reach out soon, and don't mention referrals. Thank them and end the call.` };
}

/** do_not_call on a check-in: never called again (by any account). */
export async function checkinDoNotCall(jobId: unknown) {
  const job = await getJob(jobId);
  if (!job) return null;
  await supabaseAdmin.from("voice_do_not_call").upsert({ phone: job.phone, reason: "asked on the check-in call" }, { onConflict: "phone", ignoreDuplicates: true });
  await supabaseAdmin.from("bookings").update({ checkin_status: "do_not_call", checkin_next_call_at: null }).eq("id", job.id);
  return { ok: true, message: "They won't be called again. Apologize briefly and end the call now." };
}

// ---------- After the call ----------

type CheckinCall = { id: string; job_booking_id: string; attempt: number };

async function afterCheckinNoAnswer(job: JobRow & { agents: Agent }, attempt: number) {
  if (["do_not_call", "issue", "went_well"].includes(job.checkin_status ?? "")) return null;
  const next = checkinRetryAt(attempt, job.agents.timezone);
  await supabaseAdmin.from("bookings").update(next ? { checkin_status: "scheduled", checkin_next_call_at: next.toISOString() } : { checkin_status: "no_answer", checkin_next_call_at: null }).eq("id", job.id);
  // No answer after the last try: the email goes on its own so the customer still gets the thank-you
  if (!next && job.email) await sendReferralInvite(job.agents, job, "no_call").catch(() => {});
  return next;
}

export async function checkinInitiationFailed(call: CheckinCall, failureReason: string) {
  await supabaseAdmin.from("voice_calls").update({ status: "no_answer", outcome: "no_answer", failure_reason: failureReason, ended_at: new Date().toISOString() }).eq("id", call.id);
  const job = await getJob(call.job_booking_id);
  const next = job ? await afterCheckinNoAnswer(job, call.attempt) : null;
  return { ok: true, outcome: "no_answer" as const, retryAt: next?.toISOString() ?? null };
}

export type CheckinTranscript = {
  transcript?: { role: string; message: string | null; time_in_call_secs?: number }[];
  metadata?: { start_time_unix_secs?: number; call_duration_secs?: number; termination_reason?: string; phone_call?: { call_sid?: string } };
  analysis?: { transcript_summary?: string; data_collection_results?: Record<string, { value?: unknown }> };
};

const CHECKIN_FIELDS = ["outcome", "rating", "email", "name", "feedback", "went_well"] as const;

export async function checkinPostCall(call: CheckinCall, data: CheckinTranscript) {
  const job = await getJob(call.job_booking_id);
  if (!job) return { ok: false, reason: "unknown job" };
  const results = data.analysis?.data_collection_results ?? {};
  const collected: Record<string, unknown> = {};
  for (const k of CHECKIN_FIELDS) if (results[k]?.value != null && results[k]?.value !== "") collected[k] = results[k].value;
  const rating = ratingOf(collected.rating) ?? job.checkin_rating;
  const turns = (data.transcript ?? []).filter((t) => t.role === "user" && t.message?.trim()).length;
  const outcome: CheckinOutcome = checkinOutcome({
    doNotCall: job.checkin_status === "do_not_call",
    voicemail: /voicemail/i.test(data.metadata?.termination_reason ?? "") || collected.outcome === "voicemail",
    userTurns: turns,
    issueReported: job.checkin_status === "issue",
    referralSent: !!job.referral_email_sent_at,
    collected: collected.outcome,
    rating,
  });

  const start = data.metadata?.start_time_unix_secs;
  const duration = data.metadata?.call_duration_secs;
  await supabaseAdmin
    .from("voice_calls")
    .update({
      status: outcome === "no_answer" && turns === 0 ? "no_answer" : "ended",
      answered_at: start && turns > 0 ? new Date(start * 1000).toISOString() : null,
      ended_at: start != null && duration != null ? new Date((start + duration) * 1000).toISOString() : new Date().toISOString(),
      duration_secs: duration ?? null,
      call_sid: data.metadata?.phone_call?.call_sid ?? undefined,
      outcome,
      rating,
      summary: data.analysis?.transcript_summary?.slice(0, 4000) ?? null,
      collected,
      transcript: (data.transcript ?? []).map((t) => ({ role: t.role, message: t.message, t: t.time_in_call_secs })),
    })
    .eq("id", call.id);

  let next: Date | null = null;
  const agent = job.agents;
  if (outcome === "no_answer") next = await afterCheckinNoAnswer(job, call.attempt);
  else {
    const email = typeof collected.email === "string" && EMAIL.test(collected.email.trim()) ? collected.email.trim().toLowerCase() : null;
    await supabaseAdmin
      .from("bookings")
      .update({ checkin_status: outcome, checkin_next_call_at: null, ...(rating ? { checkin_rating: rating } : {}), ...(email && !job.email ? { email } : {}), ...(typeof collected.feedback === "string" ? { checkin_feedback: collected.feedback.slice(0, 2000) } : {}) })
      .eq("id", job.id);
    if (outcome === "do_not_call") await supabaseAdmin.from("voice_do_not_call").upsert({ phone: job.phone, reason: "asked on the check-in call" }, { onConflict: "phone", ignoreDuplicates: true });
    // The tools are the main path; these catch a call where the agent didn't use them
    if (outcome === "issue") await alertRooferIssue(agent, job, String(collected.feedback ?? data.analysis?.transcript_summary ?? ""), rating);
    if (outcome === "went_well" && !job.referral_email_sent_at) await sendReferralInvite(agent, { ...job, email: job.email ?? email }, "after_call").catch((e) => console.error("[checkin] referral email failed", e));
  }

  const words: Record<CheckinOutcome, string> = {
    went_well: "heard the job went well",
    issue: "heard about a problem (you were alerted)",
    callback: "talked with them but nothing was settled",
    no_answer: "got no answer",
    do_not_call: "was asked not to call again",
  };
  const summary = data.analysis?.transcript_summary ? ` ${data.analysis.transcript_summary.slice(0, 600)}` : "";
  await logActivity(agent.id, { kind: "call", id: job.id }, "note", `Check-in call (attempt ${call.attempt} of ${CHECKIN_MAX_ATTEMPTS}): your AI assistant ${words[outcome]}${rating ? `, rated ${rating}/5` : ""}.${summary}${next ? " Trying again tomorrow." : ""}`).catch(() => {});
  return { ok: true, outcome, rating, retryAt: next?.toISOString() ?? null };
}

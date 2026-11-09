import "server-only";
import { supabaseAdmin } from "@/lib/supabase-admin";
import type { Agent } from "@/lib/booking/data";
import { resend } from "@/lib/roofing/notify";
import { sendSlackMessage } from "@/lib/slack";
import { displayPhone } from "@/lib/booking/call";
import { cleanRules, fitDetail, type FitResult, type JobRules, type LeadFacts } from "@/lib/roofing/job-rules";

// Saving how a lead or booking fit the roofer's "Jobs we take" rules (columns missing before
// 20261205000000_job_rules.sql: every write here ignores that error), and the urgent active-leak alert.

export const rulesOf = (agent: Pick<Agent, "job_rules">): JobRules | null => cleanRules(agent.job_rules);

export async function saveLeadFit(leadId: string, fit: FitResult, facts: LeadFacts) {
  const { error } = await supabaseAdmin.from("quote_requests").update({ fit_status: fit.verdict, fit_detail: fitDetail(fit), fit_facts: facts }).eq("id", leadId);
  if (error && error.code !== "42703") console.error("[fit] saving the lead's fit failed", error);
}

export async function saveBookingFit(bookingId: string, fit: FitResult) {
  const { error } = await supabaseAdmin.from("bookings").update({ fit_status: fit.verdict, fit_detail: fitDetail(fit) }).eq("id", bookingId);
  if (error && error.code !== "42703") console.error("[fit] saving the booking's fit failed", error);
}

const appUrl = () => (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** An active leak the roofer takes same-day: email and Slack them right away. */
export async function alertUrgentLeak(agent: Agent, lead: { id: string; name: string; phone: string; address: string | null }) {
  const where = lead.address ? ` at ${lead.address}` : "";
  const subject = `URGENT: active roof leak, ${lead.name}`;
  const text = `${lead.name} (${displayPhone(lead.phone)}) has water coming in${where}. Your AI assistant is offering the earliest inspection slot. You take same-day leak calls, so a quick call from you now may win the job.\n${appUrl()}/dashboard/clients?id=lead:${lead.id}`;
  const html = `<p style="font:600 18px sans-serif">Active roof leak</p><p style="font:15px/1.5 sans-serif">${esc(text).replace(/\n/g, "<br>")}</p>`;
  await resend({ to: [agent.business_email || agent.email], subject, html, text }, `urgent-leak/${lead.id}`).catch((e) => console.error("[fit] urgent email failed", e));
  if (agent.slack_user_id) await sendSlackMessage(agent.slack_user_id, `:rotating_light: *Active leak:* ${lead.name} ${displayPhone(lead.phone)}${where}. The assistant is offering the earliest slot. Call them now if you can.`).catch((e) => console.error("[fit] urgent slack failed", e));
}

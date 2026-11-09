import "server-only";
import { supabaseAdmin } from "@/lib/supabase-admin";
import type { Agent } from "@/lib/booking/data";
import { displayPhone, usPhone } from "@/lib/booking/call";
import { callerNumber, placeOutboundCall, voiceConfigured } from "@/lib/voice/elevenlabs";
import { callTimeLabel, dynamicVariables, hoursSummary, inCallWindow, nextCallTime, type LeadForCall } from "@/lib/voice/rules";

// Speed to lead: the moment a lead's row is saved, the voice agent's call is requested in the same request
// (no queue, no cron). Everything the call needs is read before or alongside the insert, so the request to
// ElevenLabs is the first thing that happens after it. Leads outside 8am–8pm in their time zone, and no-answer
// retries, get a voice_next_call_at that the every-minute cron (api/cron/voice-calls) picks up.

export type VoiceAccount = Pick<Agent, "id" | "full_name" | "timezone" | "vertical" | "service_area" | "service_radius_miles"> & { voice_agent?: boolean | null };

/** The account has the voice agent on and the ElevenLabs keys are set. */
export const voiceOnFor = (agent: { voice_agent?: boolean | null }) => !!agent.voice_agent && voiceConfigured();

export async function isDoNotCall(phone: string) {
  const { data } = await supabaseAdmin.from("voice_do_not_call").select("phone").eq("phone", phone).maybeSingle();
  return !!data;
}

/** The account's weekly hours as a sentence for the agent ("Monday to Friday 9am–5pm"). */
export async function inspectionHours(agentId: string) {
  const { data } = await supabaseAdmin.from("availability_rules").select("weekday, start_time, end_time").eq("agent_id", agentId);
  return hoursSummary(data ?? []);
}

/** The same, looked up by the account's slug, so it can run alongside the account's own lookup. */
export async function inspectionHoursBySlug(slug: string) {
  const { data } = await supabaseAdmin.from("availability_rules").select("weekday, start_time, end_time, agents!inner(slug)").eq("agents.slug", slug);
  return hoursSummary((data ?? []) as { weekday: number; start_time: string; end_time: string }[]);
}

export type FirstCallPlan =
  | { kind: "off" }
  | { kind: "skipped"; reason: string }
  | { kind: "now" }
  | { kind: "scheduled"; at: Date };

/** Whether to call now, at 8am, or not at all. Pure apart from its inputs. */
export function planFirstCall(input: { on: boolean; phone: string | null; doNotCall: boolean; tz: string; now?: Date }): FirstCallPlan {
  if (!input.on) return { kind: "off" };
  if (!input.phone || !usPhone(input.phone)) return { kind: "skipped", reason: "no usable US number" };
  if (input.doNotCall) return { kind: "skipped", reason: "on the do-not-call list" };
  const now = input.now ?? new Date();
  return inCallWindow(input.tz, now) ? { kind: "now" } : { kind: "scheduled", at: nextCallTime(input.tz, now) };
}

/** The lead's voice columns for the insert. */
export function planColumns(plan: FirstCallPlan, tz: string) {
  switch (plan.kind) {
    case "off": return {};
    case "skipped": return { voice_status: "skipped", voice_timezone: tz };
    case "now": return { voice_status: "calling", voice_timezone: tz };
    case "scheduled": return { voice_status: "scheduled", voice_next_call_at: plan.at.toISOString(), voice_timezone: tz };
  }
}

/** What the thank-you state says. */
export async function thankYouVoice(plan: FirstCallPlan, tz: string) {
  if (plan.kind !== "now" && plan.kind !== "scheduled") return null;
  const from = await callerNumber();
  const display = from ? displayPhone(from) : null;
  return plan.kind === "now" ? { status: "calling" as const, from: display } : { status: "scheduled" as const, from: display, at: plan.at.toISOString(), label: callTimeLabel(plan.at, tz) };
}

/**
 * Places one call to the lead and records it. `submittedAt` is when the lead was made (the form's submit, or
 * Meta's created_time), for the speed-to-lead log line.
 */
export async function dialLead(opts: {
  account: VoiceAccount;
  lead: LeadForCall & { phone: string };
  attempt: number;
  reason: "instant" | "scheduled" | "retry";
  hours: string;
  tz: string;
  submittedAt?: Date;
}) {
  const { account, lead, attempt, reason, hours, tz } = opts;
  const requestedAt = new Date();
  const result = await placeOutboundCall(lead.phone, dynamicVariables(lead, account, hours, tz));
  const returnedAt = new Date();

  const ms = (a: Date, b?: Date) => (b ? `${a.getTime() - b.getTime()}ms` : "?");
  console.log(
    `[voice] lead ${lead.id} attempt ${attempt} (${reason}): submit→request ${ms(requestedAt, opts.submittedAt)}, API ${ms(returnedAt, requestedAt)}${result.ok ? (result.simulated ? " (simulated)" : "") : ` FAILED: ${result.error}`}`,
  );

  const { error: callError } = await supabaseAdmin.from("voice_calls").insert({
    lead_id: lead.id,
    agent_id: account.id,
    attempt,
    reason,
    to_number: lead.phone,
    requested_at: requestedAt.toISOString(),
    api_returned_at: returnedAt.toISOString(),
    conversation_id: result.ok ? result.conversationId : null,
    call_sid: result.ok ? result.callSid : null,
    status: result.ok ? "dialing" : "failed_to_start",
    failure_reason: result.ok ? null : result.error.slice(0, 500),
  });
  if (callError) console.error("[voice] saving the call failed", callError);

  await supabaseAdmin
    .from("quote_requests")
    .update({
      voice_status: result.ok ? "calling" : "failed",
      voice_attempts: attempt,
      voice_next_call_at: null,
      ...(attempt === 1 ? { voice_first_call_at: requestedAt.toISOString() } : {}),
    })
    .eq("id", lead.id);
  return result;
}

/** Leads whose call is due (8am first calls, retries), claimed so two cron runs never call twice. */
export async function placeDueCalls(limit = 20) {
  const now = new Date().toISOString();
  const { data: due } = await supabaseAdmin
    .from("quote_requests")
    .select("id")
    .eq("voice_status", "scheduled")
    .lte("voice_next_call_at", now)
    .order("voice_next_call_at")
    .limit(limit);
  let placed = 0;
  for (const { id } of due ?? []) {
    // Claim: only one run moves it from scheduled to calling
    const { data: lead } = await supabaseAdmin
      .from("quote_requests")
      .update({ voice_status: "calling" })
      .eq("id", id)
      .eq("voice_status", "scheduled")
      .select("id, name, phone, city, address, roof_issue, coverage, source, voice_attempts, voice_timezone, agent_id, agents(*)")
      .maybeSingle();
    if (!lead) continue;
    const account = (lead as unknown as { agents: Agent }).agents;
    const tz = lead.voice_timezone ?? account.timezone;
    // Things change overnight: the toggle, the do-not-call list, the clock
    if (!voiceOnFor(account) || (await isDoNotCall(lead.phone))) {
      await supabaseAdmin.from("quote_requests").update({ voice_status: "skipped", voice_next_call_at: null }).eq("id", id);
      continue;
    }
    if (!inCallWindow(tz)) {
      await supabaseAdmin.from("quote_requests").update({ voice_status: "scheduled", voice_next_call_at: nextCallTime(tz).toISOString() }).eq("id", id);
      continue;
    }
    const attempt = (lead.voice_attempts ?? 0) + 1;
    await dialLead({ account, lead, attempt, reason: attempt === 1 ? "scheduled" : "retry", hours: await inspectionHours(account.id), tz });
    placed++;
  }
  return placed;
}

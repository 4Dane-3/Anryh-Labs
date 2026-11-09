import "server-only";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { logActivity } from "@/lib/dashboard/activity";
import { markDoNotCall } from "@/lib/voice/tools";
import { isOutcome, MAX_ATTEMPTS, retryAt, type CallOutcome } from "@/lib/voice/rules";
import { checkinInitiationFailed, checkinPostCall, type CheckinTranscript } from "@/lib/roofing/checkin";

// ElevenLabs' post-call webhook: `post_call_transcription` after every call that connected (transcript,
// analysis with our data-collection fields, metadata with the call's start time), and
// `call_initiation_failure` when the call never connected (busy, no answer). Saves it on the call and the
// lead, and schedules the no-answer retries (2 minutes, then the next day).

type Transcription = {
  type: "post_call_transcription";
  data: {
    agent_id?: string;
    conversation_id: string;
    status?: string;
    transcript?: { role: string; message: string | null; time_in_call_secs?: number }[];
    metadata?: {
      start_time_unix_secs?: number;
      call_duration_secs?: number;
      termination_reason?: string;
      phone_call?: { call_sid?: string; external_number?: string };
    };
    analysis?: {
      call_successful?: string;
      transcript_summary?: string;
      data_collection_results?: Record<string, { value?: unknown; rationale?: string }>;
    };
    conversation_initiation_client_data?: { dynamic_variables?: Record<string, unknown> };
  };
};

type InitiationFailure = {
  type: "call_initiation_failure";
  data: {
    agent_id?: string;
    conversation_id: string;
    failure_reason?: string; // "busy" | "no-answer" | "unknown"
    metadata?: { type?: string; body?: Record<string, unknown> };
  };
};

export type PostCallPayload = (Transcription | InitiationFailure | { type: string; data?: { conversation_id?: string } }) & { event_timestamp?: number };

const FIELDS = ["outcome", "owns_home", "in_service_area", "roof_issue", "roof_age", "insurance_claim", "decision_makers", "callback_time", "email", "address"] as const;

type FoundCall = { id: string; lead_id: string | null; agent_id: string; attempt: number; booking_id: string | null; kind?: string; job_booking_id?: string | null };
const CALL_FIELDS = "id, lead_id, agent_id, attempt, booking_id, kind, job_booking_id";
const isUuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v);

async function findCall(conversationId: string, vars: Record<string, unknown> | undefined): Promise<FoundCall | null> {
  // Before the check-in migration voice_calls has no kind / job_booking_id: every call is a speed-to-lead one
  let fields = CALL_FIELDS;
  let { data, error } = await supabaseAdmin.from("voice_calls").select(fields).eq("conversation_id", conversationId).maybeSingle();
  if (error?.code === "42703") {
    fields = "id, lead_id, agent_id, attempt, booking_id";
    ({ data, error } = await supabaseAdmin.from("voice_calls").select(fields).eq("conversation_id", conversationId).maybeSingle());
  }
  if (data) return data as unknown as FoundCall;
  // The API's response can lose the race with a very fast failure: fall back to the lead's (or job's) latest attempt
  const [column, id] = isUuid(vars?.lead_id) ? ["lead_id", vars.lead_id] : isUuid(vars?.job_id) ? ["job_booking_id", vars.job_id] : [null, null];
  if (!column) return null;
  const { data: latest } = await supabaseAdmin.from("voice_calls").select(fields).eq(column, id).order("attempt", { ascending: false }).limit(1).maybeSingle();
  return (latest as unknown as FoundCall | null) ?? null;
}

/** Schedules the next no-answer attempt, or ends the lead as no_answer. */
async function afterNoAnswer(leadId: string, attempt: number) {
  const { data: lead } = await supabaseAdmin.from("quote_requests").select("voice_status, voice_timezone, agents(timezone)").eq("id", leadId).maybeSingle();
  if (!lead || lead.voice_status === "do_not_call" || lead.voice_status === "booked") return null;
  const tz = lead.voice_timezone ?? (lead.agents as unknown as { timezone: string } | null)?.timezone ?? "America/New_York";
  const next = retryAt(attempt, tz);
  await supabaseAdmin
    .from("quote_requests")
    .update(next ? { voice_status: "scheduled", voice_next_call_at: next.toISOString() } : { voice_status: "no_answer", voice_next_call_at: null })
    .eq("id", leadId);
  return next;
}

export async function handlePostCall(payload: PostCallPayload) {
  const conversationId = payload.data?.conversation_id;
  if (!conversationId) return { ok: false, reason: "no conversation_id" };

  if (payload.type === "call_initiation_failure") {
    const p = payload as InitiationFailure;
    const vars = (p.data.metadata?.body as { conversation_initiation_client_data?: { dynamic_variables?: Record<string, unknown> } } | undefined)?.conversation_initiation_client_data?.dynamic_variables;
    const call = await findCall(conversationId, vars);
    if (!call) return { ok: false, reason: "unknown call" };
    if (call.kind === "checkin" && call.job_booking_id) return checkinInitiationFailed({ id: call.id, job_booking_id: call.job_booking_id, attempt: call.attempt }, p.data.failure_reason ?? "unknown");
    if (!call.lead_id) return { ok: false, reason: "unknown call" };
    await supabaseAdmin
      .from("voice_calls")
      .update({ status: "no_answer", outcome: "no_answer", failure_reason: p.data.failure_reason ?? "unknown", ended_at: new Date().toISOString() })
      .eq("id", call.id);
    const next = await afterNoAnswer(call.lead_id, call.attempt);
    return { ok: true, outcome: "no_answer" as const, retryAt: next?.toISOString() ?? null };
  }

  if (payload.type !== "post_call_transcription") return { ok: true, ignored: payload.type };
  const { data } = payload as Transcription;
  const vars = data.conversation_initiation_client_data?.dynamic_variables;
  const found = await findCall(conversationId, vars);
  if (!found) return { ok: false, reason: "unknown call" };
  if (found.kind === "checkin" && found.job_booking_id) return checkinPostCall({ id: found.id, job_booking_id: found.job_booking_id, attempt: found.attempt }, data as CheckinTranscript);
  if (!found.lead_id) return { ok: false, reason: "unknown call" };
  const call = { ...found, lead_id: found.lead_id };

  const results = data.analysis?.data_collection_results ?? {};
  const collected: Record<string, unknown> = {};
  for (const k of FIELDS) if (results[k]?.value != null && results[k]?.value !== "") collected[k] = results[k].value;

  // The outcome the agent collected; checked against what happened (a booking exists, voicemail, a very short call)
  const { data: lead } = await supabaseAdmin.from("quote_requests").select("voice_booking_id, voice_status, phone, agent_id").eq("id", call.lead_id).maybeSingle();
  // The server's own verdict on "Jobs we take" (from check_fit), kept apart: those columns need migration 20261205000000
  const { data: fitRow } = await supabaseAdmin.from("quote_requests").select("fit_status").eq("id", call.lead_id).maybeSingle();
  const notAFit = (fitRow as { fit_status?: string } | null)?.fit_status === "not_fit";
  const turns = (data.transcript ?? []).filter((t) => t.role === "user" && t.message?.trim()).length;
  const voicemail = /voicemail/i.test(data.metadata?.termination_reason ?? "") || collected.outcome === "voicemail";
  let outcome: CallOutcome;
  if (lead?.voice_booking_id) outcome = "booked";
  else if (lead?.voice_status === "do_not_call" || collected.outcome === "do_not_call") outcome = "do_not_call";
  else if (notAFit && turns > 0) outcome = "not_qualified"; // the rules decided, whatever the agent collected
  else if (voicemail || turns === 0) outcome = "no_answer";
  else if (isOutcome(collected.outcome) && collected.outcome !== "booked") outcome = collected.outcome;
  else outcome = "callback"; // they talked but nothing was booked or ruled out: a person follows up

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
      summary: data.analysis?.transcript_summary?.slice(0, 4000) ?? null,
      collected,
      transcript: (data.transcript ?? []).map((t) => ({ role: t.role, message: t.message, t: t.time_in_call_secs })),
      booking_id: lead?.voice_booking_id ?? null,
    })
    .eq("id", call.id);

  let next: Date | null = null;
  if (outcome === "no_answer") next = await afterNoAnswer(call.lead_id, call.attempt);
  else {
    if (outcome === "do_not_call" && lead?.phone) await markDoNotCall(call.lead_id, lead.phone, "asked on the call");
    await supabaseAdmin
      .from("quote_requests")
      .update({ voice_status: outcome, voice_next_call_at: null })
      .eq("id", call.lead_id);
    // Reached by the agent's assistant: the lead's outcome, unless the account already answered it
    if (outcome !== "do_not_call") await supabaseAdmin.from("quote_requests").update({ outcome: outcome === "booked" ? "booked" : "reached", outcome_at: new Date().toISOString() }).eq("id", call.lead_id).is("outcome", null);
  }

  if (lead?.agent_id) {
    const words: Record<CallOutcome, string> = {
      booked: "booked them",
      not_qualified: "found they don't qualify",
      callback: "asked for a callback from you",
      no_answer: "got no answer",
      do_not_call: "was asked not to call again",
    };
    const line = `AI assistant called (attempt ${call.attempt} of ${MAX_ATTEMPTS}) and ${words[outcome]}.${data.analysis?.transcript_summary ? ` ${data.analysis.transcript_summary.slice(0, 600)}` : ""}${next ? " Trying again later." : ""}`;
    await logActivity(lead.agent_id, { kind: "lead", id: call.lead_id }, "note", line).catch(() => {});
  }
  return { ok: true, outcome, retryAt: next?.toISOString() ?? null };
}

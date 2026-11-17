import "server-only";
import { supabaseAdmin } from "@/lib/supabase-admin";
import type { Agent } from "@/lib/booking/data";
import { displayPhone, usPhone } from "@/lib/booking/call";
import { logActivity } from "@/lib/dashboard/activity";
import { resend } from "@/lib/roofing/notify";
import { inspectionHours } from "@/lib/voice/dial";
import { markDoNotCall } from "@/lib/voice/tools";
import { spokenTimes } from "@/lib/voice/rules";
import { classifyInbound, inboundSummaryEmail, inboundVariables, leadStatusFor } from "@/lib/voice/inbound-rules";

// Inbound Emma. A roofer's own number of ours (agents.inbound_number) is imported into ElevenLabs and assigned to
// the inbound agent. When a call comes in, ElevenLabs asks /api/voice/inbound who it's for; we find the roofer by
// the number called, open a lead (so open_times / check_fit / book_inspection / do_not_call work as for a form
// lead) and hand back the roofer's preferences as dynamic variables. After the call, handleInboundPostCall keeps
// the lead only for new homeowners and emails the roofer a summary of every call.

const appUrl = () => (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");

type Initiation = { caller_id?: string; agent_id?: string; called_number?: string; call_sid?: string; conversation_id?: string };

export async function handleInboundInitiation(body: Initiation) {
  const called = usPhone(body.called_number ?? "");
  const caller = usPhone(body.caller_id ?? "");
  const { data } = called
    ? await supabaseAdmin.from("agents").select("*").eq("inbound_number", called).eq("inbound_calls", true).maybeSingle()
    : { data: null };
  const account = data as (Agent & { inbound_transfer_number?: string | null; inbound_prefs?: unknown }) | null;

  if (!account) {
    // A number that isn't (or is no longer) assigned: Emma answers politely and takes a message without booking
    console.warn(`[voice] inbound call to ${body.called_number ?? "?"} matches no account with inbound calls on`);
    return { type: "conversation_initiation_client_data", dynamic_variables: inboundVariables({ account: null, leadId: "", callId: "", hours: "", callerKnown: !!caller }) };
  }

  const company = account.full_name;
  const [{ data: lead, error: leadError }, hours] = await Promise.all([
    supabaseAdmin
      .from("quote_requests")
      .insert({
        agent_id: account.id,
        name: "Phone caller",
        phone: caller ?? (body.caller_id || "unknown"),
        consent_text: `Called ${company} at ${displayPhone(called!)} and spoke with its AI assistant, which said the call may be recorded.`,
        source: "phone",
        voice_status: "calling",
        voice_timezone: account.timezone,
        attribution: { channel: "inbound_call", inbound_mode: (account as { inbound_mode?: string }).inbound_mode ?? "" },
      })
      .select("id")
      .single(),
    inspectionHours(account.id),
  ]);
  if (leadError) console.error("[voice] inbound lead insert failed", leadError);

  const { data: call, error: callError } = await supabaseAdmin
    .from("inbound_calls")
    .insert({ agent_id: account.id, conversation_id: body.conversation_id ?? null, call_sid: body.call_sid ?? null, from_number: caller ?? body.caller_id ?? null, to_number: called, lead_id: lead?.id ?? null })
    .select("id")
    .single();
  if (callError) console.error("[voice] inbound call insert failed", callError);

  return {
    type: "conversation_initiation_client_data",
    dynamic_variables: inboundVariables({ account, leadId: lead?.id ?? "", callId: call?.id ?? "", hours, callerKnown: !!caller }),
  };
}

type InboundRow = { id: string; agent_id: string; lead_id: string | null; from_number: string | null; emailed_at: string | null };

/** The inbound call this post-call event is about, or null when it's an outbound one. */
export async function findInboundCall(conversationId: string, vars: Record<string, unknown> | undefined): Promise<InboundRow | null> {
  const fields = "id, agent_id, lead_id, from_number, emailed_at";
  const { data, error } = await supabaseAdmin.from("inbound_calls").select(fields).eq("conversation_id", conversationId).maybeSingle();
  if (error?.code === "42P01") return null; // before migration 20261218000000
  if (data) return data as InboundRow;
  const id = vars?.inbound_call_id;
  if (typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id)) return null;
  const { data: byId } = await supabaseAdmin.from("inbound_calls").select(fields).eq("id", id).maybeSingle();
  return (byId as InboundRow | null) ?? null;
}

const FIELDS = ["caller_type", "outcome", "caller_name", "message", "callback_time", "email", "address", "roof_issue", "roof_age", "owns_home", "insurance_claim", "decision_makers"] as const;

export type InboundTranscript = {
  conversation_id: string;
  transcript?: { role: string; message: string | null; time_in_call_secs?: number }[];
  metadata?: { start_time_unix_secs?: number; call_duration_secs?: number; termination_reason?: string; phone_call?: { call_sid?: string } };
  analysis?: { transcript_summary?: string; data_collection_results?: Record<string, { value?: unknown }> };
};

export async function handleInboundPostCall(call: InboundRow, data: InboundTranscript) {
  const results = data.analysis?.data_collection_results ?? {};
  const collected: Record<string, unknown> = {};
  for (const k of FIELDS) if (results[k]?.value != null && results[k]?.value !== "") collected[k] = results[k].value;

  const { data: lead } = call.lead_id
    ? await supabaseAdmin.from("quote_requests").select("id, voice_booking_id, voice_status, phone, fit_status").eq("id", call.lead_id).maybeSingle()
    : { data: null };
  const l = lead as { id: string; voice_booking_id: string | null; voice_status: string | null; phone: string; fit_status?: string | null } | null;
  const callerTurns = (data.transcript ?? []).filter((t) => t.role === "user" && t.message?.trim()).length;
  const { callerType, outcome } = classifyInbound({
    collected,
    booked: !!l?.voice_booking_id,
    doNotCall: l?.voice_status === "do_not_call" || collected.outcome === "do_not_call",
    notAFit: l?.fit_status === "not_fit",
    callerTurns,
    terminationReason: data.metadata?.termination_reason,
  });
  const callerName = typeof collected.caller_name === "string" ? collected.caller_name.slice(0, 100) : null;
  const message = typeof collected.message === "string" ? collected.message.slice(0, 2000) : null;
  const summary = data.analysis?.transcript_summary?.slice(0, 4000) ?? null;
  const start = data.metadata?.start_time_unix_secs;
  const duration = data.metadata?.call_duration_secs ?? null;

  // The lead stays only for a new homeowner (or anyone who booked); everyone else is in the summary email only
  const keepLead = !!l && (callerType === "new_customer" || outcome === "booked");
  if (l && !keepLead) {
    if (outcome === "do_not_call" && usPhone(l.phone)) await markDoNotCall(l.id, l.phone, "asked on an inbound call");
    await supabaseAdmin.from("inbound_calls").update({ lead_id: null }).eq("id", call.id);
    await supabaseAdmin.from("quote_requests").delete().eq("id", l.id).is("voice_booking_id", null);
  } else if (l) {
    if (outcome === "do_not_call" && usPhone(l.phone)) await markDoNotCall(l.id, l.phone, "asked on an inbound call");
    await supabaseAdmin
      .from("quote_requests")
      .update({
        voice_status: leadStatusFor(outcome),
        ...(callerName ? { name: callerName } : {}),
        ...(typeof collected.address === "string" ? { address: collected.address.slice(0, 300) } : {}),
        ...(typeof collected.roof_issue === "string" ? { roof_issue: collected.roof_issue.slice(0, 300) } : {}),
      })
      .eq("id", l.id);
    if (outcome !== "do_not_call") await supabaseAdmin.from("quote_requests").update({ outcome: outcome === "booked" ? "booked" : "reached", outcome_at: new Date().toISOString() }).eq("id", l.id).is("outcome", null);
  }

  await supabaseAdmin
    .from("inbound_calls")
    .update({
      caller_type: callerType,
      outcome,
      caller_name: callerName,
      message,
      summary,
      collected,
      transcript: (data.transcript ?? []).map((t) => ({ role: t.role, message: t.message, t: t.time_in_call_secs })),
      duration_secs: duration,
      call_sid: data.metadata?.phone_call?.call_sid ?? undefined,
      ...(start ? { started_at: new Date(start * 1000).toISOString() } : {}),
      ended_at: start != null && duration != null ? new Date((start + duration) * 1000).toISOString() : new Date().toISOString(),
    })
    .eq("id", call.id);

  const { data: account } = await supabaseAdmin.from("agents").select("id, full_name, email, business_email, timezone, inbound_summary_email").eq("id", call.agent_id).maybeSingle();
  const acc = account as { id: string; full_name: string; email: string; business_email?: string | null; timezone: string; inbound_summary_email?: string | null } | null;
  if (!acc) return { ok: true, inbound: true, outcome };

  let bookedLabel: string | null = null;
  if (l?.voice_booking_id) {
    const { data: b } = await supabaseAdmin.from("bookings").select("starts_at").eq("id", l.voice_booking_id).maybeSingle();
    if (b) bookedLabel = spokenTimes([b.starts_at], acc.timezone)[0]?.label ?? null;
  }
  if (keepLead && l) {
    const line = `Called in and Emma answered: ${outcome === "booked" ? `booked them${bookedLabel ? ` for ${bookedLabel}` : ""}` : outcome.replace("_", " ")}.${summary ? ` ${summary.slice(0, 600)}` : ""}`;
    await logActivity(acc.id, { kind: "lead", id: l.id }, "note", line).catch(() => {});
  }

  // Spam isn't worth an email; everything else is, including hang-ups (a missed homeowner is worth a call back)
  if (callerType !== "spam" && !call.emailed_at) {
    const phone = call.from_number && usPhone(call.from_number) ? displayPhone(call.from_number) : null;
    const email = inboundSummaryEmail({
      company: acc.full_name,
      callerType,
      outcome,
      callerName,
      phone,
      message,
      collected,
      summary,
      bookedLabel,
      durationSecs: duration,
      link: keepLead && l ? `${appUrl()}/dashboard/clients?id=lead:${l.id}` : null,
    });
    const to = acc.inbound_summary_email || acc.business_email || acc.email;
    try {
      const r = await resend({ to: [to], subject: email.subject, html: email.html, text: email.text }, `inbound-summary/${call.id}`);
      if (!r.skipped) await supabaseAdmin.from("inbound_calls").update({ emailed_at: new Date().toISOString() }).eq("id", call.id);
      else console.log(`[voice] inbound summary (email not configured) → ${to}: ${email.subject}`);
    } catch (e) {
      console.error("[voice] inbound summary email failed", e);
    }
  }
  return { ok: true, inbound: true, callerType, outcome };
}

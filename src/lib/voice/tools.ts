import "server-only";
import { timingSafeEqual } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getSlotBoard, type Agent } from "@/lib/booking/data";
import { createBooking } from "@/lib/booking/create";
import { ROOFING_ADDRESS_KEY, ROOFING_HOMEOWNER_KEY, type IntakeAnswers } from "@/lib/booking/questions";
import { isRoofer } from "@/lib/verticals";
import { voiceConfig } from "@/lib/voice/elevenlabs";
import { spokenTimes } from "@/lib/voice/rules";
import { DECISION_MAKERS_KEY, PROPERTY_KEY, evaluateLead, notFitMessage, unanswered, type LeadFacts } from "@/lib/roofing/job-rules";
import { alertUrgentLeak, rulesOf, saveBookingFit, saveLeadFit } from "@/lib/roofing/fit";

// The voice agent's server tools, called by ElevenLabs during the call (configure them as webhook tools with
// the header `x-voice-secret: <ELEVENLABS_WEBHOOK_SECRET>` and lead_id bound to the {{lead_id}} variable).

export function validToolSecret(req: Request) {
  const secret = voiceConfig().webhookSecret;
  const given = req.headers.get("x-voice-secret") ?? req.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  if (!secret || !given) return false;
  const a = Buffer.from(secret);
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}

type LeadRow = {
  id: string;
  agent_id: string;
  name: string;
  phone: string;
  email: string | null;
  address: string | null;
  city: string | null;
  roof_issue: string | null;
  consent_text: string;
  attribution: Record<string, string> | null;
  voice_status: string | null;
  voice_timezone: string | null;
  voice_booking_id: string | null;
  fit_facts?: LeadFacts | null; // what check_fit has learned so far (missing before 20261205000000)
  fit_status?: string | null;
  fit_detail?: { urgent?: boolean } | null;
  agents: Agent;
};

async function getLead(leadId: unknown): Promise<LeadRow | null> {
  if (typeof leadId !== "string" || !/^[0-9a-f-]{36}$/i.test(leadId)) return null;
  const base = "id, agent_id, name, phone, email, address, city, roof_issue, consent_text, attribution, voice_status, voice_timezone, voice_booking_id, agents(*)";
  const { data: first, error } = await supabaseAdmin.from("quote_requests").select(`${base}, fit_facts, fit_status, fit_detail`).eq("id", leadId).maybeSingle();
  // Before the job-rules migration those columns don't exist
  const data = error?.code === "42703" ? (await supabaseAdmin.from("quote_requests").select(base).eq("id", leadId).maybeSingle()).data : first;
  return (data as unknown as LeadRow) ?? null;
}

const s = (v: unknown, max = 200) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** open_times: { lead_id, day? } → a few open times in the lead's time zone, from the same board the page uses. */
export async function openTimesTool(body: Record<string, unknown>) {
  const lead = await getLead(body.lead_id);
  if (!lead) return { error: "Unknown lead." };
  const tz = lead.voice_timezone ?? lead.agents.timezone;
  const { open } = await getSlotBoard(lead.agents);
  const times = spokenTimes(open, tz, s(body.day, 10) || null);
  if (!times.length) return { times: [], message: s(body.day) ? "Nothing open that day. Offer the soonest times instead (call again without a day)." : "No open times in the next two weeks. Offer a callback from the team instead." };
  return { timezone: tz, times, message: "Offer one or two of these by their label. When they choose, call book_inspection with that time's start exactly as given." };
}

const FACT_FIELDS: [string, keyof LeadFacts][] = [
  ["roof_issue", "roofIssue"], ["job_type", "jobType"], ["roof_age", "roofAge"], ["roof_type", "roofType"], ["owns_home", "ownsHome"],
  ["property_type", "property"], ["insurance_claim", "insuranceClaim"], ["decision_makers", "decisionMakers"], ["address", "address"],
];

/** What we know about the lead: the form's answers, what check_fit stored earlier, then whatever this call passes. */
function leadFacts(lead: LeadRow, body: Record<string, unknown>): LeadFacts {
  const facts: LeadFacts = { roofIssue: lead.roof_issue, address: lead.address, city: lead.city, ...(lead.fit_facts ?? {}) };
  const set = facts as Record<string, unknown>;
  for (const [field, key] of FACT_FIELDS) if (s(body[field], 300)) set[key] = s(body[field], 300);
  if (typeof body.active_leak === "boolean") facts.activeLeak = body.active_leak;
  else if (typeof body.active_leak === "string" && /^(true|yes|y)$/i.test(body.active_leak.trim())) facts.activeLeak = true;
  else if (typeof body.active_leak === "string" && /^(false|no|n)$/i.test(body.active_leak.trim())) facts.activeLeak = false;
  const dollars = Number(body.job_dollars);
  if (Number.isFinite(dollars) && dollars > 0) facts.jobDollars = dollars;
  return facts;
}

const notFitReply = (agent: Agent) => ({
  fits: false,
  verdict: "not_fit" as const,
  message: `${notFitMessage(agent.full_name)} Say that kindly in your own words (never say why, and never mention rules), do not book anything or offer times, then end the call.`,
});

/**
 * check_fit: { lead_id, roof_issue?, job_type?, roof_age?, roof_type?, owns_home?, property_type?, insurance_claim?,
 * decision_makers?, address?, active_leak?, job_dollars? } → checks what they've said against the roofer's rules
 * ("Jobs we take"), on the server. Not a fit: the lead is saved as such and the agent ends politely. Otherwise it
 * says what's still worth asking (only what the rules need) and, for an active leak the roofer takes same-day,
 * alerts them. Call it as answers come in, and again before booking.
 */
export async function checkFitTool(body: Record<string, unknown>) {
  const lead = await getLead(body.lead_id);
  if (!lead) return { error: "Unknown lead." };
  const agent = lead.agents;
  const rules = rulesOf(agent);
  const facts = leadFacts(lead, body);
  const fit = evaluateLead(rules, facts);
  const alreadyUrgent = lead.fit_detail?.urgent === true;
  await saveLeadFit(lead.id, fit, facts);
  if (fit.verdict === "not_fit") return notFitReply(agent);
  if (fit.urgent && !alreadyUrgent) await alertUrgentLeak(agent, { id: lead.id, name: lead.name, phone: lead.phone, address: facts.address ?? null });
  const ask = unanswered(rules, facts);
  return {
    fits: true,
    verdict: fit.verdict,
    urgent: fit.urgent,
    still_to_ask: ask.map((a) => ({ field: a.key === "homeowner" ? "owns_home" : a.key === PROPERTY_KEY ? "property_type" : a.key === DECISION_MAKERS_KEY ? "decision_makers" : a.key, question: a.ask })),
    ...(agent.job_rules && rules?.financing ? { financing: "The company offers financing. Mention it only if they ask about cost or payment." } : {}),
    message: [
      fit.urgent ? "They have water coming in and the company takes same-day leak calls: say you'll get the earliest inspection, call open_times without a day, and offer the very first time. The company has been alerted." : "",
      fit.emergencyDeclined ? "They have an active leak but the company doesn't do same-day calls: don't promise same-day. Suggest a tarp or bucket to limit damage and offer the next normal inspection time." : "",
      ask.length ? "Ask the questions in still_to_ask one at a time, calling check_fit after the answers." : "Nothing more to ask. Go on to open_times and book_inspection.",
      "Never discuss insurance claims, free roofs or deductibles beyond asking if they've filed a claim.",
    ].filter(Boolean).join(" "),
  };
}

/**
 * book_inspection: { lead_id, start, name?, email?, address?, owns_home?, roof_issue?, roof_age?, insurance_claim?,
 * decision_makers?, notes? } → books it through createBooking (emails, CRM webhook, Meta, markFormLeadBooked).
 */
export async function bookTool(body: Record<string, unknown>, origin: string) {
  const lead = await getLead(body.lead_id);
  if (!lead) return { error: "Unknown lead." };
  if (lead.voice_status === "do_not_call") return { error: "This person asked not to be called. End the call politely." };
  if (lead.voice_booking_id) return { booked: true, message: "Already booked on this call. Confirm the time with them." };
  const agent = lead.agents;
  const roof = isRoofer(agent);

  // The server decides whether they fit "Jobs we take", on everything said so far: never the model's say-so
  const rules = rulesOf(agent);
  const facts = leadFacts(lead, body);
  const fit = evaluateLead(rules, facts);
  if (fit.verdict === "not_fit") {
    await saveLeadFit(lead.id, fit, facts);
    return notFitReply(agent);
  }

  const startRaw = s(body.start, 40);
  const startMs = Date.parse(startRaw);
  if (!Number.isFinite(startMs)) return { error: "Use a start time from open_times exactly as given." };
  const { open } = await getSlotBoard(agent);
  const startsAt = open.find((t) => Date.parse(t) === startMs);
  if (!startsAt) return { error: "That time isn't open any more. Call open_times again and offer another." };

  const address = s(body.address) || [lead.address, lead.city].filter(Boolean).join(", ");
  if (roof && !address) return { error: "Ask for the full address of the home first." };
  const email = s(body.email, 200).toLowerCase();
  const answers: IntakeAnswers = {};
  const put = (key: string, label: string, value: unknown) => {
    const v = s(value, 300);
    if (v) answers[key] = { label, value: v };
  };
  if (roof) {
    put(ROOFING_ADDRESS_KEY, "Address of the home to inspect", address);
    put(ROOFING_HOMEOWNER_KEY, "Do you own this home?", facts.ownsHome);
    put("roof_issue", "What's going on with the roof?", facts.roofIssue);
    put("roof_age", "About how old is the roof?", facts.roofAge);
    put("roof_type", "What kind of roof is it?", facts.roofType);
    put(PROPERTY_KEY, "Is it a home or a business?", facts.property);
    put("insurance_claim", "Have you filed an insurance claim for it?", facts.insuranceClaim);
    put(DECISION_MAKERS_KEY, "Will everyone who decides be there?", facts.decisionMakers);
  }
  put("notes", roof ? "Anything the inspector should know?" : "Extra notes for your agent to know before the appointment", `Booked on the phone by the AI assistant.${s(body.notes, 300) ? ` ${s(body.notes, 300)}` : ""}`);

  const result = await createBooking(
    agent,
    {
      startsAt,
      name: s(body.name, 100) || lead.name,
      email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : lead.email ?? "",
      phone: lead.phone,
      attribution: { ...(lead.attribution ?? {}), booked_by: "voice_agent" },
    },
    // The consent they gave on the form covers this booking's calls and texts
    { answers, consentText: lead.consent_text, timezone: lead.voice_timezone ?? agent.timezone, origin, ...(roof ? { fit: { result: fit, rules } } : {}) },
  );
  if (!result.ok) return { error: result.status === 409 ? "That time was just taken. Call open_times again and offer another." : "Booking failed. Tell them the team will call to confirm a time." };

  // booked_at is left to markFormLeadBooked (it runs after the response): it only tells Meta about a form lead
  // whose booked_at is still empty
  await supabaseAdmin.from("quote_requests").update({ voice_booking_id: result.booking.id, voice_status: "booked" }).eq("id", lead.id);
  if (roof) {
    await Promise.all([saveLeadFit(lead.id, fit, facts), saveBookingFit(result.booking.id, fit)]);
    if (fit.urgent && !lead.fit_detail?.urgent) await alertUrgentLeak(agent, { id: lead.id, name: lead.name, phone: lead.phone, address });
  }
  const when = spokenTimes([result.booking.starts_at], lead.voice_timezone ?? agent.timezone)[0]?.label;
  return { booked: true, booking_id: result.booking.id, when, message: `Booked for ${when}. Confirm it back to them${roof ? " with the address" : ""}.` };
}

/** do_not_call: { lead_id } → never called again by any account. The agent apologizes and ends the call. */
export async function doNotCallTool(body: Record<string, unknown>) {
  const lead = await getLead(body.lead_id);
  if (!lead) return { error: "Unknown lead." };
  await markDoNotCall(lead.id, lead.phone, "asked on the call");
  return { ok: true, message: "They won't be called again. Apologize briefly and end the call now." };
}

export async function markDoNotCall(leadId: string, phone: string, reason: string) {
  await supabaseAdmin.from("voice_do_not_call").upsert({ phone, reason, lead_id: leadId }, { onConflict: "phone", ignoreDuplicates: true });
  await supabaseAdmin.from("quote_requests").update({ voice_status: "do_not_call", voice_next_call_at: null }).eq("id", leadId);
}

// Inbound Emma's rules, kept pure for the tests: the roofer's preferences, what the agent is told when a call
// comes in, how a finished call is classified, and the summary email.

export const INBOUND_MODES = ["forward", "direct", "mix"] as const;
export type InboundMode = (typeof INBOUND_MODES)[number];
export const isInboundMode = (v: unknown): v is InboundMode => (INBOUND_MODES as readonly string[]).includes(v as string);

export const INBOUND_MODE_COPY: Record<InboundMode, { label: string; short: string; detail: string }> = {
  forward: {
    label: "Option 1: Emma answers the calls you miss",
    short: "Missed calls only",
    detail: "Keep your number everywhere. Your phone forwards to Emma when nobody picks up, so you or your office still answer first.",
  },
  direct: {
    label: "Option 2: Emma answers every call",
    short: "Every call",
    detail: "We give you a new number for your website, Google profile and ads. Emma answers every call and screens it.",
  },
  mix: {
    label: "Mix: our number on the ads, yours everywhere else",
    short: "Ads on our number",
    detail: "Use our number on your ads and landing page so every ad call is answered and counted. Your own number stays on everything else.",
  },
};

export const INBOUND_PRICE_DOLLARS = 250;

export type InboundPrefs = {
  tone: "casual" | "formal";
  transfer_existing: boolean; // existing customers go straight to the transfer number
  transfer_urgent: boolean; // water coming in right now goes straight to the transfer number
  faqs: string; // their answers: financing, warranty, brands, how soon they come out…
  notes: string; // anything else Emma should know about the company
};

export const DEFAULT_INBOUND_PREFS: InboundPrefs = { tone: "casual", transfer_existing: true, transfer_urgent: true, faqs: "", notes: "" };

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

export function cleanInboundPrefs(raw: unknown): InboundPrefs {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    tone: r.tone === "formal" ? "formal" : "casual",
    transfer_existing: r.transfer_existing !== false,
    transfer_urgent: r.transfer_urgent !== false,
    faqs: str(r.faqs, 2000),
    notes: str(r.notes, 1000),
  };
}

export type InboundAccount = {
  full_name: string;
  timezone: string;
  service_area?: string | null;
  service_radius_miles?: number | null;
  inbound_transfer_number?: string | null;
  inbound_prefs?: unknown;
};

/**
 * The call's dynamic variables, returned by the initiation webhook. Every variable the prompt uses is always
 * present (an empty string when unknown), or ElevenLabs refuses to start the conversation.
 */
export function inboundVariables(input: { account: InboundAccount | null; leadId: string; callId: string; hours: string; callerKnown: boolean }) {
  const a = input.account;
  const prefs = cleanInboundPrefs(a?.inbound_prefs);
  const transfer = a?.inbound_transfer_number ?? "";
  return {
    lead_id: input.leadId,
    inbound_call_id: input.callId,
    company_name: a?.full_name ?? "the company",
    service_area: a ? [a.service_area, a.service_radius_miles ? `within ${a.service_radius_miles} miles` : ""].filter(Boolean).join(", ") : "",
    inspection_hours: input.hours,
    lead_timezone: a?.timezone ?? "America/Los_Angeles",
    caller_number_known: input.callerKnown ? "yes" : "no",
    transfer_number: transfer,
    can_transfer: transfer ? "yes" : "no",
    transfer_existing: transfer && prefs.transfer_existing ? "yes" : "no",
    transfer_urgent: transfer && prefs.transfer_urgent ? "yes" : "no",
    tone: prefs.tone === "formal" ? "polished and formal" : "friendly and casual",
    company_faqs: prefs.faqs || "(none given: say the team will follow up)",
    company_notes: prefs.notes || "(none)",
    line_ready: a ? "yes" : "no",
  };
}

// ---------- After the call ----------

export const CALLER_TYPES = ["new_customer", "existing_customer", "vendor", "spam", "other"] as const;
export type CallerType = (typeof CALLER_TYPES)[number];
export const INBOUND_OUTCOMES = ["booked", "message", "transferred", "not_qualified", "callback", "do_not_call", "hung_up"] as const;
export type InboundOutcome = (typeof INBOUND_OUTCOMES)[number];

const isCallerType = (v: unknown): v is CallerType => (CALLER_TYPES as readonly string[]).includes(v as string);
const isInboundOutcome = (v: unknown): v is InboundOutcome => (INBOUND_OUTCOMES as readonly string[]).includes(v as string);

/**
 * What happened, from what the agent collected checked against what the server knows: a booking exists, the
 * caller asked not to be called, the call was transferred, or the caller never spoke.
 */
export function classifyInbound(input: {
  collected: Record<string, unknown>;
  booked: boolean;
  doNotCall: boolean;
  notAFit: boolean;
  callerTurns: number;
  terminationReason?: string | null;
}): { callerType: CallerType; outcome: InboundOutcome } {
  const c = input.collected;
  let callerType: CallerType = isCallerType(c.caller_type) ? c.caller_type : "other";
  if (input.booked) callerType = "new_customer";
  if (input.callerTurns === 0) return { callerType: input.booked ? callerType : "other", outcome: input.booked ? "booked" : "hung_up" };
  if (input.booked) return { callerType, outcome: "booked" };
  if (input.doNotCall) return { callerType, outcome: "do_not_call" };
  if (/transfer/i.test(input.terminationReason ?? "") || c.outcome === "transferred") return { callerType, outcome: "transferred" };
  if (input.notAFit && callerType === "new_customer") return { callerType, outcome: "not_qualified" };
  if (isInboundOutcome(c.outcome) && c.outcome !== "booked" && c.outcome !== "hung_up") return { callerType, outcome: c.outcome };
  return { callerType, outcome: callerType === "new_customer" ? "callback" : "message" };
}

/** The lead's voice_status for a kept new-homeowner lead. */
export function leadStatusFor(outcome: InboundOutcome) {
  if (outcome === "booked" || outcome === "not_qualified" || outcome === "do_not_call") return outcome;
  return "callback";
}

const CALLER_WORDS: Record<CallerType, string> = {
  new_customer: "New customer",
  existing_customer: "Existing customer",
  vendor: "Supplier or vendor",
  spam: "Spam or sales call",
  other: "Other caller",
};

const OUTCOME_WORDS: Record<InboundOutcome, string> = {
  booked: "Booked an inspection",
  message: "Took a message",
  transferred: "Transferred to you",
  not_qualified: "Not a job you take",
  callback: "Wants a call back",
  do_not_call: "Asked not to be contacted",
  hung_up: "Hung up before saying anything",
};

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The summary email to the roofer (pure). */
export function inboundSummaryEmail(input: {
  company: string;
  callerType: CallerType;
  outcome: InboundOutcome;
  callerName: string | null;
  phone: string | null; // display form
  message: string | null;
  collected: Record<string, unknown>;
  summary: string | null;
  bookedLabel: string | null;
  durationSecs: number | null;
  link: string | null;
  /** A clinic's call: a consultation, never an inspection */
  clinic?: boolean;
}) {
  const who = input.callerName || (input.phone ? input.phone : "Unknown caller");
  const subject = `${input.outcome === "booked" ? "Booked" : OUTCOME_WORDS[input.outcome]}: ${who} called ${input.company}`;
  const c = input.collected;
  const rows: [string, string][] = [
    ["Caller", CALLER_WORDS[input.callerType]],
    ["What happened", (input.clinic && input.outcome === "booked" ? "Booked a consultation" : OUTCOME_WORDS[input.outcome]) + (input.bookedLabel ? `, ${input.bookedLabel}` : "")],
    ["Name", input.callerName ?? ""],
    ["Phone", input.phone ?? "Hidden"],
    ["Message", input.message ?? ""],
    ["Call back", typeof c.callback_time === "string" ? c.callback_time : ""],
    ["Address", typeof c.address === "string" ? c.address : ""],
    ["Roof", typeof c.roof_issue === "string" ? c.roof_issue : ""],
    ["18 or older", typeof c.adult === "string" ? c.adult : ""],
    ["Interested in", typeof c.interest === "string" ? c.interest : ""],
    ["Timeline", typeof c.timeline === "string" ? c.timeline : ""],
    ["Email", typeof c.email === "string" ? c.email : ""],
    ["Length", input.durationSecs != null ? `${Math.max(1, Math.round(input.durationSecs / 60))} min` : ""],
  ].filter(([, v]) => v) as [string, string][];
  const text = [
    `${who} called ${input.company}, and Emma answered.`,
    "",
    ...rows.map(([k, v]) => `${k}: ${v}`),
    ...(input.summary ? ["", `Summary: ${input.summary}`] : []),
    ...(input.link ? ["", input.link] : []),
  ].join("\n");
  const html = `<div style="font:15px/1.5 sans-serif;color:#111">
<p style="font:600 18px sans-serif;margin:0 0 12px">${esc(who)} called ${esc(input.company)}</p>
<table style="border-collapse:collapse">${rows.map(([k, v]) => `<tr><td style="padding:3px 16px 3px 0;color:#666;vertical-align:top">${esc(k)}</td><td style="padding:3px 0">${esc(v)}</td></tr>`).join("")}</table>
${input.summary ? `<p style="margin:16px 0 0"><b>Summary:</b> ${esc(input.summary)}</p>` : ""}
${input.link ? `<p style="margin:16px 0 0"><a href="${esc(input.link)}">Open in your dashboard</a></p>` : ""}
</div>`;
  return { subject, text, html };
}

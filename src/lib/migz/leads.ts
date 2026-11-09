import "server-only";
import { DateTime } from "luxon";
import { supabaseAdmin } from "@/lib/supabase-admin";
import type { Agent } from "@/lib/booking/data";
import { usPhone } from "@/lib/booking/call";
import { LEGACY_QUOTE_CONSENT_TEXT, QUOTE_CONSENT_TEXT } from "@/lib/booking/constants";
import { dialLead, inspectionHours, isDoNotCall, planColumns, planFirstCall, voiceOnFor } from "@/lib/voice/dial";
import { voiceConfigured } from "@/lib/voice/elevenlabs";
import { sendFormLeadEmail } from "@/lib/booking/email";
import { newFormLeadMessage } from "@/lib/booking/format";
import { landingUrl } from "@/lib/booking/sites";
import { sendSlackMessage } from "@/lib/slack";
import { logActivity } from "@/lib/dashboard/activity";
import { leadPingBlocks } from "@/lib/dashboard/outcomes";
import { createLeadForm, getFormLeads, getLead, leadFormBlocker, type MetaLead } from "@/lib/meta/ads";
import { sendLeadStageEvent } from "@/lib/meta/capi";
import { recordEventAlert } from "@/lib/admin/alerts";
import { cleanFocus, TOPICS } from "@/lib/migz/topics";
import { DEFAULT_INTENT, isIntentLevel } from "@/lib/ad-options";

// Instant forms (low–medium intent): Migz makes one lead form on the agent's Page and every form ad uses it.
// Leads arrive through Meta's leadgen webhook (api/webhooks/meta-leads) and, as a backstop, each sync polls
// the form. Each lead joins the agent's call-backs (quote_requests, source instant_form) and pings their
// Slack; if the lead later books a call, Meta is told on the lead (a CRM conversion).

// Form leads also get an email with the booking link, so their consent names email too
const formConsent = (quote: string) => `${quote.replace("by phone and text", "by phone, text and email")} By submitting, you ask to be called back about life insurance.`;
export const FORM_CONSENT_TEXT = formConsent(QUOTE_CONSENT_TEXT);
/** What forms made before AI-voice consent show (their leads are never called by the voice agent) */
const LEGACY_FORM_CONSENT_TEXT = formConsent(LEGACY_QUOTE_CONSENT_TEXT);

/** Roofers never run instant forms: an inspection needs an address and a time, which the booking page asks for. */
export const wantsInstantForms = (agent: Pick<Agent, "intent_level" | "vertical">) =>
  agent.vertical !== "roofing" && (isIntentLevel(agent.intent_level) ? agent.intent_level : DEFAULT_INTENT) === "low_medium";

const appUrl = () => (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");

/**
 * The agent's lead form, made on first use. Returns null (and records why, once per reason) when Meta
 * refuses: usually the Page hasn't accepted the lead ads terms, which only a person can do.
 */
export async function ensureLeadForm(agent: Agent): Promise<string | null> {
  if (agent.meta_lead_form_id) return agent.meta_lead_form_id;
  if (!agent.meta_page_id) return null;
  try {
    const focus = cleanFocus(agent.ad_focus);
    const id = await createLeadForm(agent.meta_page_id, {
      name: `Migz · ${agent.full_name} · free call`,
      privacyUrl: `${appUrl()}/privacy`,
      consentText: `Leave your details and ${agent.full_name.split(" ")[0]} will call you back for a free, no-pressure chat about your options. ${FORM_CONSENT_TEXT}`,
      topics: focus.map((k) => ({ key: k, label: TOPICS[k].label })),
      bookingUrl: landingUrl(agent.slug, appUrl()),
      agentName: agent.full_name,
    });
    await supabaseAdmin.from("agents").update({ meta_lead_form_id: id, lead_form_blocked: null }).eq("id", agent.id);
    // Its consent names AI-voice calls (a separate update: the column is missing before the voice migration)
    await supabaseAdmin.from("agents").update({ meta_lead_form_ai_consent: true }).eq("id", agent.id);
    agent.meta_lead_form_ai_consent = true;
    agent.meta_lead_form_id = id;
    agent.lead_form_blocked = null;
    return id;
  } catch (e) {
    const why = leadFormBlocker(e);
    if (agent.lead_form_blocked !== why) {
      await supabaseAdmin.from("agents").update({ lead_form_blocked: why }).eq("id", agent.id);
      await recordEventAlert({ agentId: agent.id, key: `lead_form:${why.slice(0, 40)}`, severity: "warn", title: "Instant form couldn't be made", detail: `The agent chose more leads (instant forms), but ${why}. Their ads keep running on the booking page until it's fixed.` });
    }
    agent.lead_form_blocked = why;
    return null;
  }
}

const field = (lead: MetaLead, ...names: string[]) => lead.field_data.find((f) => names.includes(f.name))?.values?.[0]?.trim() ?? "";

/**
 * Saves one form lead as a call-back and tells the agent. Returns false when it was already saved. When the
 * voice agent is on, its call is requested right after the insert, before anything else. `receivedAt` is when
 * the webhook arrived (null from the backstop poll), so Meta's delay (received - created_time) is on the lead.
 */
export async function saveFormLead(agent: Agent, lead: MetaLead, opts: { receivedAt?: Date | null; hours?: Promise<string> } = {}) {
  const name = field(lead, "full_name", "first_name") || "Instant form lead";
  const phone = usPhone(field(lead, "phone_number", "phone"));
  const email = field(lead, "email") || null;
  const coverageKey = field(lead, "coverage");
  const coverage = coverageKey in TOPICS ? TOPICS[coverageKey as keyof typeof TOPICS].label : coverageKey || null;
  const city = field(lead, "city") || null;
  const aiConsent = !!agent.meta_lead_form_ai_consent;
  // The voice agent calls form leads whose form's consent covers AI calls, fresh from the webhook (a lead the
  // backstop poll finds a day later isn't "speed to lead"; the agent calls those themselves)
  const createdAt = new Date(lead.created_time);
  const fresh = !!opts.receivedAt || Date.now() - createdAt.getTime() < 60 * 60_000;
  const voiceOn = aiConsent && fresh && voiceOnFor(agent);
  const plan = voiceOn ? planFirstCall({ on: true, phone, doNotCall: phone ? await isDoNotCall(phone) : false, tz: agent.timezone }) : ({ kind: "off" } as const);
  const { data, error } = await supabaseAdmin
    .from("quote_requests")
    .insert({
      agent_id: agent.id,
      source: "instant_form",
      name: name.slice(0, 120),
      // A form without a usable US number still counts as a lead (the agent can email); keep what was typed
      phone: phone ?? field(lead, "phone_number", "phone").slice(0, 30),
      email,
      coverage,
      consent_text: aiConsent ? FORM_CONSENT_TEXT : LEGACY_FORM_CONSENT_TEXT,
      consented_at: lead.created_time,
      created_at: lead.created_time,
      meta_lead_id: lead.id,
      meta_form_id: lead.form_id ?? null,
      meta_ad_id: lead.ad_id ?? null,
      attribution: { utm_source: "meta", utm_medium: "instant_form", ...(lead.ad_id ? { utm_content: lead.ad_id } : {}) },
      ...(voiceConfigured() && opts.receivedAt ? { received_at: opts.receivedAt.toISOString() } : {}),
      ...(voiceOn ? { city: city?.slice(0, 80) ?? null, ...planColumns(plan, agent.timezone) } : {}),
    })
    .select("id")
    .single();
  if (data && plan.kind === "now" && phone) {
    // The dial starts now; the Slack ping and email below run while it's in flight
    const call = (async () =>
      dialLead({
        account: agent,
        lead: { id: data.id, name, phone, city, coverage, source: "instant_form" },
        attempt: 1,
        reason: "instant",
        hours: await (opts.hours ?? inspectionHours(agent.id)),
        tz: agent.timezone,
        submittedAt: createdAt,
      }))().catch((e) => console.error("[voice] dial failed", e));
    try {
      return await finishFormLead(agent, lead, data.id, { name, phone, email, coverage });
    } finally {
      await call;
    }
  }
  if (error?.code === "23505") return false;
  if (error || !data) throw new Error(`Couldn't save the form lead: ${error?.message}`);
  return finishFormLead(agent, lead, data.id, { name, phone, email, coverage });
}

async function finishFormLead(agent: Agent, lead: MetaLead, id: string, p: { name: string; phone: string | null; email: string | null; coverage: string | null }) {
  const { name, phone, email, coverage } = p;
  const data = { id };
  if (agent.slack_user_id) {
    const text = newFormLeadMessage({ name, phone, email, coverage });
    await sendSlackMessage(agent.slack_user_id, text, leadPingBlocks(text, "lead", data.id)).catch((e) => console.error("slack notify failed", e));
  }
  // Right away, while they're still thinking about it: thanks, and the link to book the call themselves
  if (email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    const sent = await sendFormLeadEmail({ agent, leadId: lead.id, prospect: { name, email } }).catch((e) => console.error("form lead email failed", e));
    if (sent && !sent.skipped) {
      // The 48-hour follow-ups count from this email
      await supabaseAdmin.from("quote_requests").update({ last_emailed_at: new Date().toISOString() }).eq("id", data.id);
      await logActivity(agent.id, { kind: "lead", id: data.id }, "email", "Thanks for your quote request (with your booking link)");
    }
  }
  return true;
}

/** One lead from the webhook: fetched from Meta (the webhook only carries its id) and saved. */
export async function receiveLead(agent: Agent, leadId: string, receivedAt: Date = new Date()) {
  if (!agent.meta_page_id) return false;
  // The account's hours (for the voice agent) are read while Meta is fetched, not after
  const hours = voiceOnFor(agent) ? inspectionHours(agent.id).catch(() => "") : undefined;
  return saveFormLead(agent, await getLead(agent.meta_page_id, leadId), { receivedAt, hours });
}

/** The backstop: the form's leads from the last 3 days, saving any the webhook missed. */
export async function pullFormLeads(agent: Agent) {
  if (!agent.meta_page_id || !agent.meta_lead_form_id) return 0;
  const since = Math.floor(DateTime.now().minus({ days: 3 }).toSeconds());
  let saved = 0;
  for (const lead of await getFormLeads(agent.meta_page_id, agent.meta_lead_form_id, since)) if (await saveFormLead(agent, lead)) saved++;
  return saved;
}

/**
 * A booking came in: if the same person sent an instant form in the last 30 days, the lead is marked booked
 * and Meta is told on the lead, so form ads learn to find people who go on to talk to the agent.
 */
export async function markFormLeadBooked(agentId: string, contact: { phone?: string | null; email?: string | null }, bookingId: string) {
  const ors = [contact.phone && `phone.eq.${contact.phone}`, contact.email && `email.eq.${contact.email.trim().toLowerCase()}`].filter(Boolean);
  if (!ors.length) return false;
  const { data: lead } = await supabaseAdmin
    .from("quote_requests")
    .select("id, meta_lead_id")
    .eq("agent_id", agentId)
    .eq("source", "instant_form")
    .is("booked_at", null)
    .gte("created_at", new Date(Date.now() - 30 * 86_400_000).toISOString())
    .or(ors.join(","))
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!lead?.meta_lead_id) return false;
  await supabaseAdmin.from("quote_requests").update({ booked_at: new Date().toISOString() }).eq("id", lead.id);
  // Its outcome is "booked" (the call gets its own ask); unless the agent already answered. No-op before the outcomes migration
  await supabaseAdmin.from("quote_requests").update({ outcome: "booked", outcome_at: new Date().toISOString(), outcome_sent: "Contact" }).eq("id", lead.id).is("outcome", null);
  await sendLeadStageEvent({ leadId: lead.meta_lead_id, eventName: "Schedule", eventId: `lead-booked:${bookingId}` });
  return true;
}

/**
 * The lead form an ad in this ad set must open: null for a booking-page ad set. An ad going into an
 * instant-form ad set without a form can't be built, so that throws with the reason.
 */
export async function leadFormFor(agent: Agent, metaAdsetId: string) {
  const { data, error } = await supabaseAdmin.from("ad_sets").select("destination").eq("meta_adset_id", metaAdsetId).maybeSingle();
  if (error || data?.destination !== "instant_form") return null;
  const id = await ensureLeadForm(agent);
  if (!id) throw new Error(`This ad set uses an instant form, but ${agent.lead_form_blocked ?? "the form couldn't be made"}.`);
  return id;
}

/** Where an ad set sends people (website before the intent-level migration). */
export async function destinationOf(metaAdsetId: string) {
  const { data, error } = await supabaseAdmin.from("ad_sets").select("destination").eq("meta_adset_id", metaAdsetId).maybeSingle();
  return !error && data?.destination === "instant_form" ? "instant_form" : "website";
}

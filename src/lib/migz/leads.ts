import "server-only";
import { DateTime } from "luxon";
import { supabaseAdmin } from "@/lib/supabase-admin";
import type { Agent } from "@/lib/booking/data";
import { usPhone } from "@/lib/booking/call";
import { QUOTE_CONSENT_TEXT } from "@/lib/booking/constants";
import { newFormLeadMessage } from "@/lib/booking/format";
import { landingUrl } from "@/lib/booking/sites";
import { sendSlackMessage } from "@/lib/slack";
import { createLeadForm, getFormLeads, getLead, leadFormBlocker, type MetaLead } from "@/lib/meta/ads";
import { sendLeadStageEvent } from "@/lib/meta/capi";
import { recordEventAlert } from "@/lib/admin/alerts";
import { cleanFocus, TOPICS } from "@/lib/migz/topics";
import { DEFAULT_INTENT, isIntentLevel } from "@/lib/ad-options";

// Instant forms (low–medium intent): Migz makes one lead form on the agent's Page and every form ad uses it.
// Leads arrive through Meta's leadgen webhook (api/webhooks/meta-leads) and, as a backstop, each sync polls
// the form. Each lead joins the agent's call-backs (quote_requests, source instant_form) and pings their
// Slack; if the lead later books a call, Meta is told on the lead (a CRM conversion).

export const FORM_CONSENT_TEXT = `${QUOTE_CONSENT_TEXT} By submitting, you ask to be called back about life insurance.`;

export const wantsInstantForms = (agent: Pick<Agent, "intent_level">) => (isIntentLevel(agent.intent_level) ? agent.intent_level : DEFAULT_INTENT) === "low_medium";

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

/** Saves one form lead as a call-back and tells the agent. Returns false when it was already saved. */
export async function saveFormLead(agent: Agent, lead: MetaLead) {
  const name = field(lead, "full_name", "first_name") || "Instant form lead";
  const phone = usPhone(field(lead, "phone_number", "phone"));
  const email = field(lead, "email") || null;
  const coverageKey = field(lead, "coverage");
  const coverage = coverageKey in TOPICS ? TOPICS[coverageKey as keyof typeof TOPICS].label : coverageKey || null;
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
      consent_text: FORM_CONSENT_TEXT,
      consented_at: lead.created_time,
      created_at: lead.created_time,
      meta_lead_id: lead.id,
      meta_form_id: lead.form_id ?? null,
      meta_ad_id: lead.ad_id ?? null,
      attribution: { utm_source: "meta", utm_medium: "instant_form", ...(lead.ad_id ? { utm_content: lead.ad_id } : {}) },
    })
    .select("id")
    .single();
  if (error?.code === "23505") return false;
  if (error || !data) throw new Error(`Couldn't save the form lead: ${error?.message}`);
  if (agent.slack_user_id) {
    await sendSlackMessage(agent.slack_user_id, newFormLeadMessage({ name, phone, email, coverage })).catch((e) => console.error("slack notify failed", e));
  }
  return true;
}

/** One lead from the webhook: fetched from Meta (the webhook only carries its id) and saved. */
export async function receiveLead(agent: Agent, leadId: string) {
  if (!agent.meta_page_id) return false;
  return saveFormLead(agent, await getLead(agent.meta_page_id, leadId));
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

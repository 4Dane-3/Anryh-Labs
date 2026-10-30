import "server-only";
import { createHash } from "node:crypto";
import { graph } from "@/lib/meta/graph";

const sha256 = (v: string) => createHash("sha256").update(v).digest("hex");

/**
 * Sends conversion events to Meta's Conversions API. A booked call sends "Schedule" and "Lead"; a quote
 * request sends "Lead" only. Ad sets optimize for LEAD (both count, so Meta gets enough events to learn),
 * while Schedule keeps booked calls countable on their own. Only contact details go to Meta, hashed as
 * required; prep answers (DOB, health, coverage) never leave our database.
 *
 * Visits from an ad also send browsing steps, with no contact details: PageView when the page opens (Meta
 * shows these as landing page views) and InitiateCheckout when they pick a call time.
 */
export async function sendConversionEvents(input: {
  events: ("Schedule" | "Lead" | "PageView" | "InitiateCheckout")[];
  eventId: string; // the booking or quote request id (or visit + step); Meta dedupes on event name + id
  email?: string | null;
  phone?: string | null; // E.164; none for browsing steps
  pageUrl: string;
  attribution: Record<string, string>;
  ip?: string | null;
  userAgent?: string | null;
}) {
  const pixelId = process.env.META_PIXEL_ID;
  if (!pixelId || !process.env.META_SYSTEM_USER_TOKEN) return { skipped: true as const };

  const userData: Record<string, unknown> = {};
  if (input.phone) userData.ph = [sha256(input.phone.replace(/\D/g, ""))];
  if (input.email) userData.em = [sha256(input.email.trim().toLowerCase())];
  if (input.attribution._fbp) userData.fbp = input.attribution._fbp;
  // Prefer the cookie; otherwise build fbc from the click id per Meta's format, with when the ad was
  // clicked (partner sites remember it as fbclid_at) rather than when the booking came in
  if (input.attribution._fbc) userData.fbc = input.attribution._fbc;
  else if (input.attribution.fbclid) {
    const clickedAt = Number(input.attribution.fbclid_at);
    const at = Number.isFinite(clickedAt) && clickedAt > 0 && clickedAt <= Date.now() ? Math.floor(clickedAt) : Date.now();
    userData.fbc = `fb.1.${at}.${input.attribution.fbclid}`;
  }
  userData.country = [sha256("us")]; // every agent sells in US states
  if (input.ip) userData.client_ip_address = input.ip;
  if (input.userAgent) userData.client_user_agent = input.userAgent;

  await graph("POST", `${pixelId}/events`, {
    data: input.events.map((event_name) => ({
      event_name,
      event_time: Math.floor(Date.now() / 1000),
      event_id: input.eventId, // dedupes against a browser pixel event with the same name and id
      action_source: "website",
      event_source_url: input.pageUrl,
      user_data: userData,
    })),
    ...(process.env.META_TEST_EVENT_CODE ? { test_event_code: process.env.META_TEST_EVENT_CODE } : {}),
  });
  return { skipped: false as const };
}

/**
 * Tells Meta an instant-form lead went on to book a call: a CRM event on the lead itself (Conversions API for
 * CRM), so Meta learns which form leads turn into real conversations, not just which ones fill in the form.
 */
export async function sendLeadStageEvent(input: { leadId: string; eventName: "Schedule" | "Contact" | "Purchase"; eventId: string; valueCents?: number | null }) {
  const pixelId = process.env.META_PIXEL_ID;
  if (!pixelId || !process.env.META_SYSTEM_USER_TOKEN) return { skipped: true as const };
  await graph("POST", `${pixelId}/events`, {
    data: [
      {
        event_name: input.eventName,
        event_time: Math.floor(Date.now() / 1000),
        event_id: input.eventId,
        action_source: "system_generated",
        user_data: { lead_id: Number(input.leadId) || input.leadId },
        custom_data: { event_source: "crm", lead_event_source: "Migz AI", ...(input.eventName === "Purchase" ? purchaseValue(input.valueCents) : {}) },
      },
    ],
    ...(process.env.META_TEST_EVENT_CODE ? { test_event_code: process.env.META_TEST_EVENT_CODE } : {}),
  });
  return { skipped: false as const };
}

/** A sale's value for Meta: a year of the monthly premium when the agent gave it, else 0. */
const purchaseValue = (monthlyCents: number | null | undefined) => ({ currency: "USD", value: monthlyCents ? Math.round((monthlyCents * 12) / 100) : 0 });

/**
 * What happened after a booking or quote request, as follow-up events matched on the same hashed contact
 * details and Meta cookies/click id as the original Lead/Schedule: "ShowedUp" (a custom event) when the call
 * happened, "Contact" when a quote request was reached, "Purchase" when it sold, with a year of premium as the
 * value when the agent gave it. No names, prep answers or call notes; each event is sent once (event_id).
 */
export async function sendOutcomeEvents(input: {
  events: ("ShowedUp" | "Contact" | "Purchase")[];
  eventId: string; // the booking or quote request id
  email?: string | null;
  phone?: string | null;
  attribution: Record<string, string>;
  valueCents?: number | null;
}) {
  const pixelId = process.env.META_PIXEL_ID;
  if (!pixelId || !process.env.META_SYSTEM_USER_TOKEN || !input.events.length) return { skipped: true as const };
  const userData: Record<string, unknown> = { country: [sha256("us")] };
  if (input.phone) userData.ph = [sha256(input.phone.replace(/\D/g, ""))];
  if (input.email) userData.em = [sha256(input.email.trim().toLowerCase())];
  if (input.attribution._fbp) userData.fbp = input.attribution._fbp;
  if (input.attribution._fbc) userData.fbc = input.attribution._fbc;
  else if (input.attribution.fbclid) {
    const clickedAt = Number(input.attribution.fbclid_at);
    if (Number.isFinite(clickedAt) && clickedAt > 0) userData.fbc = `fb.1.${Math.floor(clickedAt)}.${input.attribution.fbclid}`;
  }
  await graph("POST", `${pixelId}/events`, {
    data: input.events.map((event_name) => ({
      event_name,
      event_time: Math.floor(Date.now() / 1000),
      event_id: `${event_name}:${input.eventId}`,
      action_source: "system_generated",
      user_data: userData,
      ...(event_name === "Purchase" ? { custom_data: purchaseValue(input.valueCents) } : {}),
    })),
    ...(process.env.META_TEST_EVENT_CODE ? { test_event_code: process.env.META_TEST_EVENT_CODE } : {}),
  });
  return { skipped: false as const };
}

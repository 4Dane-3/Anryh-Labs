"use server";

import { isAnryhAdmin } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { usPhone, displayPhone } from "@/lib/booking/call";
import { dialLead, inspectionHours, isDoNotCall, type VoiceAccount } from "@/lib/voice/dial";
import { checkinConfigured, voiceConfigured } from "@/lib/voice/elevenlabs";
import { placeDemoCheckin } from "@/lib/roofing/checkin";
import type { Agent } from "@/lib/booking/data";

export type DemoCheckinInput = {
  accountId: string;
  phone: string;
  name: string; // the customer's full name
  email: string; // optional: Emma reads it back, or asks for one
  address: string;
  company: string;
  rewardDollars: string; // blank = $100
  goal: string; // blank = 5
};

/** Emma's post-job check-in, placed now to the number you type. See placeDemoCheckin. */
export async function placeDemoCheckinCall(input: DemoCheckinInput): Promise<Result> {
  if (!(await isAnryhAdmin())) return { ok: false, error: "Staff only." };
  if (!checkinConfigured()) return { ok: false, error: "The check-in agent isn't set up yet: set ELEVENLABS_CHECKIN_AGENT_ID (plus the API key, phone number ID and webhook secret)." };
  const phone = usPhone(input.phone);
  if (!phone) return { ok: false, error: "Enter a US phone number with its area code." };
  if (await isDoNotCall(phone)) return { ok: false, error: "That number is on the do-not-call list." };
  const name = input.name.trim().slice(0, 80);
  if (!name) return { ok: false, error: "Add the customer's name." };
  const company = input.company.trim().slice(0, 80);
  if (!company) return { ok: false, error: "Add the company name Emma should use." };
  const email = input.email.trim().toLowerCase();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: "That email doesn't look right. Leave it blank and Emma will ask for one." };
  const dollars = input.rewardDollars.trim() === "" ? 100 : Number(input.rewardDollars.replace(/[$,\s]/g, ""));
  if (!Number.isFinite(dollars) || dollars < 0 || dollars > 1000) return { ok: false, error: "Enter a gift card amount between $0 and $1,000." };
  const goal = input.goal.trim() === "" ? 5 : Number(input.goal);
  if (!Number.isInteger(goal) || goal < 1 || goal > 20) return { ok: false, error: "Referrals needed should be 1 to 20." };

  const { data: agent } = await supabaseAdmin.from("agents").select("*").eq("id", input.accountId).maybeSingle();
  if (!agent) return { ok: false, error: "Pick the account the demo job goes on." };

  const result = await placeDemoCheckin(agent as Agent, { phone, name, email: email || null, address: input.address.trim(), company, rewardCents: Math.round(dollars * 100), goal });
  if (!result.ok) return { ok: false, error: `The call didn't start: ${result.error}` };
  return result.simulated
    ? { ok: true, simulated: true, message: `Simulated, nothing was dialed (outside production the app only dials VOICE_TEST_NUMBER, and only with VOICE_LIVE_CALLS=1).` }
    : { ok: true, simulated: false, message: `Emma is calling ${displayPhone(phone)} for the check-in now.` };
}

export type DemoCallInput = {
  accountId: string;
  phone: string;
  firstName: string;
  company: string; // what Emma calls the company
  business: "roofing" | "life insurance";
  city: string;
  address: string;
  roofIssue: string;
  interest: string; // life insurance: what they asked about
  serviceArea: string;
  hours: string; // blank = the account's own hours
  timezone: string;
};

type Result = { ok: true; message: string; simulated: boolean } | { ok: false; error: string };

/**
 * A staff-triggered demo: Emma calls the number you type, right now, with the variables you typed. It makes a real
 * lead on the chosen account (marked as a demo in its consent text), so Emma's tools work and a booking she makes
 * lands on that account's calendar. Skips the 8am–8pm window and the account's voice toggle (you are choosing to
 * call), but not the do-not-call list.
 */
export async function placeDemoCall(input: DemoCallInput): Promise<Result> {
  if (!(await isAnryhAdmin())) return { ok: false, error: "Staff only." };
  if (!voiceConfigured()) return { ok: false, error: "The voice agent isn't set up yet: ELEVENLABS_API_KEY, ELEVENLABS_AGENT_ID, ELEVENLABS_PHONE_NUMBER_ID and ELEVENLABS_WEBHOOK_SECRET." };
  const phone = usPhone(input.phone);
  if (!phone) return { ok: false, error: "Enter a US phone number with its area code." };
  if (await isDoNotCall(phone)) return { ok: false, error: "That number is on the do-not-call list." };
  const first = input.firstName.trim().slice(0, 40);
  if (!first) return { ok: false, error: "Add their first name." };
  const company = input.company.trim().slice(0, 80);
  if (!company) return { ok: false, error: "Add the company name Emma should use." };

  const { data: agent } = await supabaseAdmin
    .from("agents")
    .select("id, full_name, timezone, vertical, service_area, service_radius_miles, voice_agent")
    .eq("id", input.accountId)
    .maybeSingle();
  if (!agent) return { ok: false, error: "Pick the account the demo lead goes on." };

  const roof = input.business === "roofing";
  const tz = input.timezone.trim() || agent.timezone;
  const hours = input.hours.trim() || (await inspectionHours(agent.id));
  const now = new Date();

  const { data: lead, error } = await supabaseAdmin
    .from("quote_requests")
    .insert({
      agent_id: agent.id,
      name: first,
      phone,
      coverage: roof ? null : input.interest.trim() || null,
      consent_text: "Demo call placed by Anryh Labs staff. The person asked for this call.",
      received_at: now.toISOString(),
      voice_status: "calling",
      voice_timezone: tz,
      ...(roof ? { address: input.address.trim() || null, city: input.city.trim() || null, roof_issue: input.roofIssue.trim() || null } : { city: input.city.trim() || null }),
    })
    .select("id")
    .single();
  if (error || !lead) {
    console.error("demo lead insert failed", error);
    return { ok: false, error: "Couldn't create the demo lead." };
  }

  // The company, business and service area come from the form, not the account, so Emma sounds like their company
  const account: VoiceAccount = {
    ...agent,
    full_name: company,
    vertical: roof ? "roofing" : "insurance",
    service_area: input.serviceArea.trim() || agent.service_area,
    service_radius_miles: input.serviceArea.trim() ? null : agent.service_radius_miles,
  };
  const result = await dialLead({
    account,
    lead: { id: lead.id, name: first, phone, city: input.city, address: input.address, roof_issue: input.roofIssue, coverage: input.interest, source: "page" },
    attempt: 1,
    reason: "instant",
    hours,
    tz,
    submittedAt: now,
  });
  if (!result.ok) return { ok: false, error: `The call didn't start: ${result.error}` };
  return result.simulated
    ? { ok: true, simulated: true, message: `Simulated, nothing was dialed (outside production the app only dials VOICE_TEST_NUMBER, and only with VOICE_LIVE_CALLS=1).` }
    : { ok: true, simulated: false, message: `Emma is calling ${displayPhone(phone)} now.` };
}

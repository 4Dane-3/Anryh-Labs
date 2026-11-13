import "server-only";
import { createHash } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { request, validateOnly } from "@/lib/google-ads/api";
import type { GoogleAccount } from "@/lib/google-ads/account";
import { DEFAULT_JOB_VALUE_DOLLARS } from "@/lib/google-ads/playbook";

// Sends booked inspections and closed jobs back to Google as conversions. Each ad click lands on the roofer's
// page with a gclid (or gbraid/wbraid on iPhone), saved with the booking. A booking from a Google click becomes a
// "Booked inspection" conversion; when the job is marked done (the dashboard's Job done or the CRM webhook) it
// also becomes a "Closed roofing job" with the job's value. With the customer's hashed email and phone too
// (enhanced conversions for leads), so Google can match a click even when the click id is missing.
//
// This is what lets Google's bidding find people who book and buy, not just people who click.

const CLICK_WINDOW_DAYS = 88; // Google takes clicks up to 90 days old

type BookingRow = { id: string; email: string; phone: string; created_at: string; job_done_at: string | null; attribution: Record<string, string> | null };

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const normEmail = (e: string) => e.trim().toLowerCase();
const normPhone = (p: string) => {
  const d = p.replace(/\D/g, "");
  return d.length === 10 ? `+1${d}` : d.length === 11 && d.startsWith("1") ? `+${d}` : null;
};

/** Google's date format: "2026-11-12 14:03:00+00:00". */
export const googleTime = (iso: string) => `${new Date(iso).toISOString().slice(0, 19).replace("T", " ")}+00:00`;

/** Whether a booking came from a Google ad click. */
export const fromGoogle = (a: Record<string, string> | null | undefined) => !!(a?.gclid || a?.gbraid || a?.wbraid || (a?.utm_source ?? "").toLowerCase() === "google");

export function conversionFor(b: BookingRow, action: string, at: string, valueDollars: number | null) {
  const a = b.attribution ?? {};
  const ids = [normEmail(b.email) && { hashedEmail: sha(normEmail(b.email)) }, normPhone(b.phone ?? "") && { hashedPhoneNumber: sha(normPhone(b.phone)!) }].filter(Boolean);
  return {
    conversionAction: action,
    conversionDateTime: googleTime(at),
    ...(a.gclid ? { gclid: a.gclid } : a.gbraid ? { gbraid: a.gbraid } : a.wbraid ? { wbraid: a.wbraid } : {}),
    ...(valueDollars ? { conversionValue: valueDollars, currencyCode: "USD" } : {}),
    ...(ids.length ? { userIdentifiers: ids } : {}),
    orderId: `${b.id}:${action.split("/").pop()}`, // Google drops a repeat with the same order id
  };
}

async function upload(customerId: string, conversions: unknown[]) {
  if (!conversions.length) return 0;
  await request(`customers/${customerId}:uploadClickConversions`, { conversions, partialFailure: true, validateOnly: validateOnly() });
  return conversions.length;
}

/** Uploads the booked inspections and closed jobs not sent yet. Returns how many of each. */
export async function sendConversions(account: GoogleAccount, avgJobDollars: number | null) {
  const { booked, closed } = account.conversion_actions ?? {};
  if (!booked && !closed) return { booked: 0, closed: 0 };
  const since = new Date(Date.now() - CLICK_WINDOW_DAYS * 86_400_000).toISOString();
  const { data } = await supabaseAdmin
    .from("bookings")
    .select("id, email, phone, created_at, job_done_at, attribution, google_booked_sent_at, google_closed_sent_at")
    .eq("agent_id", account.agent_id)
    .gte("created_at", since)
    .or("attribution->>gclid.not.is.null,attribution->>gbraid.not.is.null,attribution->>wbraid.not.is.null,attribution->>utm_source.eq.google")
    .or("google_booked_sent_at.is.null,and(job_done_at.not.is.null,google_closed_sent_at.is.null)")
    .limit(500);
  const rows = ((data ?? []) as (BookingRow & { google_booked_sent_at: string | null; google_closed_sent_at: string | null })[]).filter((b) => fromGoogle(b.attribution));
  const toBook = booked ? rows.filter((b) => !b.google_booked_sent_at) : [];
  const toClose = closed ? rows.filter((b) => b.job_done_at && !b.google_closed_sent_at) : [];
  const nBooked = await upload(account.customer_id, toBook.map((b) => conversionFor(b, booked!, b.created_at, null)));
  const nClosed = await upload(account.customer_id, toClose.map((b) => conversionFor(b, closed!, b.job_done_at!, avgJobDollars ?? DEFAULT_JOB_VALUE_DOLLARS)));
  if (!validateOnly()) {
    const now = new Date().toISOString();
    if (toBook.length) await supabaseAdmin.from("bookings").update({ google_booked_sent_at: now }).in("id", toBook.map((b) => b.id));
    if (toClose.length) await supabaseAdmin.from("bookings").update({ google_closed_sent_at: now }).in("id", toClose.map((b) => b.id));
  }
  return { booked: nBooked, closed: nClosed };
}

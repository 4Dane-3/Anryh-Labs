import "server-only";
import { createHash } from "node:crypto";
import { graph } from "@/lib/meta/graph";

const sha256 = (v: string) => createHash("sha256").update(v).digest("hex");

/**
 * Sends a "Schedule" event to Meta's Conversions API when someone books a call, so ad sets
 * optimized for SCHEDULE learn which people actually book. Only contact details go to Meta,
 * hashed as required; prep answers (DOB, health, coverage) never leave our database.
 */
export async function sendScheduleEvent(input: {
  bookingId: string;
  email: string;
  phone: string; // E.164
  pageUrl: string;
  attribution: Record<string, string>;
  ip?: string | null;
  userAgent?: string | null;
}) {
  const pixelId = process.env.META_PIXEL_ID;
  if (!pixelId || !process.env.META_SYSTEM_USER_TOKEN) return { skipped: true as const };

  const userData: Record<string, unknown> = {
    em: [sha256(input.email.trim().toLowerCase())],
    ph: [sha256(input.phone.replace(/\D/g, ""))],
  };
  if (input.attribution._fbp) userData.fbp = input.attribution._fbp;
  // Prefer the cookie; otherwise build fbc from the click id per Meta's format
  if (input.attribution._fbc) userData.fbc = input.attribution._fbc;
  else if (input.attribution.fbclid) userData.fbc = `fb.1.${Date.now()}.${input.attribution.fbclid}`;
  if (input.ip) userData.client_ip_address = input.ip;
  if (input.userAgent) userData.client_user_agent = input.userAgent;

  await graph("POST", `${pixelId}/events`, {
    data: [
      {
        event_name: "Schedule",
        event_time: Math.floor(Date.now() / 1000),
        event_id: input.bookingId, // dedupes against a browser pixel event with the same id
        action_source: "website",
        event_source_url: input.pageUrl,
        user_data: userData,
      },
    ],
    ...(process.env.META_TEST_EVENT_CODE ? { test_event_code: process.env.META_TEST_EVENT_CODE } : {}),
  });
  return { skipped: false as const };
}

import "server-only";
import { IANAZone } from "luxon";
import type { Agent } from "@/lib/booking/data";
import { confirmationEmail } from "@/lib/booking/confirmation-email";
import { bookingIcs } from "@/lib/booking/ics";
import { leadEmail } from "@/lib/booking/lead-email";
import { landingUrl, leadEmailSender, partnerPageUrl, partnerPhoto, prepareUrl } from "@/lib/booking/sites";

// Booking emails, sent with Resend. Needs RESEND_API_KEY and BOOKING_EMAIL_FROM (an address on a domain
// verified in Resend, e.g. bookings@anryhlabs.com); without them nothing is sent and booking works as before.
// The email goes out under the agent's name, and replies go to the agent.

const appUrl = () => (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");

export function bookingEmailReady() {
  return !!process.env.RESEND_API_KEY && !!process.env.BOOKING_EMAIL_FROM;
}

/** Tells the prospect their call is confirmed, with the event attached. Throws when Resend refuses it. */
export async function sendBookingConfirmation(input: {
  agent: Agent;
  booking: { id: string; token: string; starts_at: string; ends_at: string };
  prospect: { name: string; email: string; phone: string };
  timezone?: unknown; // the prospect's browser timezone, when the page sent it
  pageUrl?: unknown;
}) {
  if (!bookingEmailReady()) return { skipped: true as const };
  const { agent, booking, prospect } = input;
  const timezone = typeof input.timezone === "string" && IANAZone.isValidZone(input.timezone) ? input.timezone : agent.timezone;
  const partner = partnerPageUrl(input.pageUrl);
  const email = confirmationEmail({
    agent: { fullName: agent.full_name, photoUrl: agent.photo_url || partnerPhoto(agent.slug), title: agent.title ?? null, licenseNumber: agent.license_number },
    prospect: { name: prospect.name, phone: prospect.phone },
    startsAt: booking.starts_at,
    minutes: agent.slot_minutes,
    timezone,
    calendarUrl: `${appUrl()}/api/bookings/ics?token=${booking.token}`,
    prepareUrl: prepareUrl(agent.slug, booking.token, appUrl()), // on the partner site when the agent has one
    bookedOn: new URL(partner ?? appUrl()).hostname.replace(/^www\./, ""),
  });

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      // A retried request never sends the email twice
      "Idempotency-Key": `booking-confirmation/${booking.id}`,
    },
    body: JSON.stringify({
      from: `${agent.full_name.replace(/[<>"]/g, "")} <${process.env.BOOKING_EMAIL_FROM}>`,
      to: [prospect.email],
      reply_to: agent.email,
      subject: email.subject,
      html: email.html,
      text: email.text,
      attachments: [{ filename: "call.ics", content: Buffer.from(bookingIcs(booking, agent.full_name)).toString("base64") }],
      // Keeps Gmail from folding two bookings' emails into one thread
      headers: { "X-Entity-Ref-ID": booking.id },
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return { skipped: false as const };
}

/**
 * Thanks an instant-form lead and offers the booking link, from the agent's partner domain when they have one
 * (Miguel: noreply@foreignfinancial.org), else BOOKING_EMAIL_FROM. Replies go to the agent. Skipped (not sent)
 * without the sender's postal address, which CAN-SPAM requires. Throws when Resend refuses it.
 */
export async function sendFormLeadEmail(input: { agent: Agent; leadId: string; prospect: { name: string; email: string } }) {
  const sender = leadEmailSender(input.agent.slug);
  if (!process.env.RESEND_API_KEY || !sender) return { skipped: true as const };
  const { agent, prospect } = input;
  // Tagged, so a booking from the email shows up as the follow-up email rather than a direct visit
  const page = landingUrl(agent.slug, appUrl());
  const [base, hash] = page.split("#");
  const bookUrl = `${base}?utm_source=email&utm_medium=lead_followup${hash ? `#${hash}` : ""}`;
  const email = leadEmail({
    agent: { fullName: agent.full_name, title: agent.title ?? null, licenseNumber: agent.license_number, email: agent.email },
    prospect: { name: prospect.name },
    bookUrl,
    site: new URL(base).hostname.replace(/^www\./, ""),
    business: { name: sender.business, postalAddress: sender.postalAddress },
  });

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      // The webhook and the backstop poll can both see a lead; it's emailed once
      "Idempotency-Key": `form-lead/${input.leadId}`,
    },
    body: JSON.stringify({
      from: `${agent.full_name.replace(/[<>"]/g, "")} <${sender.from}>`,
      to: [prospect.email],
      reply_to: agent.email,
      subject: email.subject,
      html: email.html,
      text: email.text,
      // The mail app's own unsubscribe button: an email to the agent, who stops emailing them
      headers: { "List-Unsubscribe": `<mailto:${agent.email}?subject=Unsubscribe>` },
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return { skipped: false as const };
}

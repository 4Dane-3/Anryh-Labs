import "server-only";
import { IANAZone } from "luxon";
import type { Agent } from "@/lib/booking/data";
import { confirmationEmail } from "@/lib/booking/confirmation-email";
import { bookingIcs } from "@/lib/booking/ics";
import { followUpEmail, leadEmail, triedCallEmail, type LeadEmailInput } from "@/lib/booking/lead-email";
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

type LeadNote = ReturnType<typeof leadEmail>;

/**
 * Sends one of the agent's plain notes to a lead (lead-email.ts), from the agent's partner domain when they
 * have one (Miguel: miguel@foreignfinancial.org), else BOOKING_EMAIL_FROM. Replies go to the agent. Skipped
 * (not sent) without the sender's postal address, which CAN-SPAM requires. Throws when Resend refuses it.
 */
async function sendLeadNote(
  input: { agent: Agent; idempotencyKey: string; to: string; utmMedium: string },
  build: (parts: Pick<LeadEmailInput, "agent" | "bookUrl" | "bookPage" | "business">) => LeadNote,
) {
  const sender = leadEmailSender(input.agent.slug);
  if (!process.env.RESEND_API_KEY || !sender) return { skipped: true as const };
  const { agent } = input;
  // Tagged, so a booking from the email shows up as the follow-up email rather than a direct visit
  const page = landingUrl(agent.slug, appUrl());
  const [base, hash] = page.split("#");
  const bookUrl = `${base}?utm_source=email&utm_medium=${input.utmMedium}${hash ? `#${hash}` : ""}`;
  const { hostname, pathname } = new URL(base);
  const email = build({
    agent: { fullName: agent.full_name, title: agent.title ?? null, licenseNumber: agent.license_number, email: agent.email },
    bookUrl,
    bookPage: `${hostname.replace(/^www\./, "")}${pathname.replace(/\/$/, "")}`, // the link reads as the page it opens, e.g. foreignfinancial.org/miguel-cruz
    business: { name: sender.business, postalAddress: sender.postalAddress },
  });

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      // A retried request (or a lead seen twice) never sends the same note twice
      "Idempotency-Key": input.idempotencyKey,
    },
    body: JSON.stringify({
      from: `${agent.full_name.replace(/[<>"]/g, "")} <${sender.from}>`,
      to: [input.to],
      reply_to: agent.email,
      subject: email.subject,
      html: email.html,
      text: email.text,
      // No List-Unsubscribe header: it marks mail as bulk, and Gmail files bulk mail under Promotions. The
      // footer's reply-to-unsubscribe is the opt-out (replies go to the agent).
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return { skipped: false as const };
}

/** Thanks an instant-form lead and offers the booking link, the moment they arrive. */
export function sendFormLeadEmail(input: { agent: Agent; leadId: string; prospect: { name: string; email: string } }) {
  // The webhook and the backstop poll can both see a lead; it's emailed once
  return sendLeadNote({ agent: input.agent, idempotencyKey: `form-lead/${input.leadId}`, to: input.prospect.email, utmMedium: "lead_followup" }, (parts) =>
    leadEmail({ ...parts, prospect: { name: input.prospect.name } }),
  );
}

/** "Sorry I missed you": after the agent logs a call that didn't get through, once per lead or booking. */
export function sendTriedCallEmail(input: { agent: Agent; subjectId: string; via: "instant_form" | "page" | "booking"; prospect: { name: string; email: string } }) {
  return sendLeadNote({ agent: input.agent, idempotencyKey: `tried-call/${input.subjectId}`, to: input.prospect.email, utmMedium: "tried_call" }, (parts) =>
    triedCallEmail({ ...parts, prospect: { name: input.prospect.name }, via: input.via, message: input.agent.followup_message }),
  );
}

/** The nth 48-hour follow-up to a lead the agent hasn't reached (followups.ts decides when). */
export function sendFollowUpEmail(input: { agent: Agent; leadId: string; n: number; via: "instant_form" | "page"; prospect: { name: string; email: string } }) {
  return sendLeadNote({ agent: input.agent, idempotencyKey: `follow-up/${input.leadId}/${input.n}`, to: input.prospect.email, utmMedium: `follow_up_${input.n}` }, (parts) =>
    followUpEmail({ ...parts, prospect: { name: input.prospect.name }, via: input.via }, input.n),
  );
}

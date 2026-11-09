import "server-only";
import type { CrmMeeting, CrmSettings } from "@/lib/crm/types";
import { inviteEmail, type InviteKind } from "@/lib/crm/invite-email";
import { meetingIcs } from "@/lib/crm/ics";

// Sends the CRM's meeting emails with Resend, the same way booking confirmations go out (RESEND_API_KEY
// and BOOKING_EMAIL_FROM, an address on a domain verified in Resend). Replies go to the CRM settings'
// reply-to address.
//
// Outside production nothing reaches a real client: the email is logged to the server console instead,
// or, when CRM_EMAIL_TEST_TO is set, sent to that address. Set CRM_EMAIL_LIVE=1 to send for real in dev.

export const appUrl = () => (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");
export const confirmUrl = (token: string) => `${appUrl()}/meet/${token}`;

export function crmEmailReady() {
  return !!process.env.RESEND_API_KEY && !!process.env.BOOKING_EMAIL_FROM;
}

export type SendOutcome = { sent: true; to: string } | { logged: true; reason: string } | { skipped: true; reason: string };

export async function sendMeetingEmail(input: {
  kind: InviteKind;
  meeting: CrmMeeting;
  client: { name: string | null; email: string };
  settings: CrmSettings;
}): Promise<SendOutcome> {
  const { meeting, client, settings, kind } = input;
  const email = inviteEmail({ kind, from: settings.from_name, client, meeting, confirmUrl: confirmUrl(meeting.token) });
  // The calendar file goes with the emails about a meeting that's still ahead; the rebook email is about a
  // missed one, so it has none
  const ics = kind === "rebook" ? null : meetingIcs(meeting, { name: settings.from_name, email: settings.reply_to }, kind === "cancel" ? "CANCEL" : "PUBLISH");

  const live = process.env.NODE_ENV === "production" || process.env.CRM_EMAIL_LIVE === "1";
  const testTo = process.env.CRM_EMAIL_TEST_TO?.trim();
  if (!live && !testTo) {
    console.info(`[crm email: logged, not sent] ${kind} → ${client.email}\n  Subject: ${email.subject}\n  Confirm link: ${confirmUrl(meeting.token)}\n${email.text.replace(/^/gm, "  | ")}`);
    return { logged: true, reason: "Dev: the email was logged to the server console, not sent. Set CRM_EMAIL_TEST_TO to send it to yourself." };
  }
  if (!crmEmailReady()) return { skipped: true, reason: "Email isn't set up: add RESEND_API_KEY and BOOKING_EMAIL_FROM." };
  const to = live ? client.email : testTo!;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      // A retried request never sends the same email twice
      "Idempotency-Key": `crm-${kind}/${meeting.id}/${meeting.sequence}/${Date.parse(meeting.starts_at)}`,
    },
    body: JSON.stringify({
      from: `${settings.from_name.replace(/[<>"]/g, "")} <${process.env.BOOKING_EMAIL_FROM}>`,
      to: [to],
      ...(settings.reply_to ? { reply_to: settings.reply_to } : {}),
      subject: live ? email.subject : `[test → ${client.email}] ${email.subject}`,
      html: email.html,
      text: email.text,
      ...(ics ? { attachments: [{ filename: kind === "cancel" ? "cancelled.ics" : "invite.ics", content: Buffer.from(ics).toString("base64"), content_type: "text/calendar" }] } : {}),
      headers: { "X-Entity-Ref-ID": `${meeting.id}-${kind}` },
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return { sent: true, to };
}

export const unsubscribeUrl = (token: string) => `${appUrl()}/unsubscribe/${token}`;

/**
 * A follow-up email (offer and process recap). Same rules as the meeting emails: logged in dev unless
 * CRM_EMAIL_TEST_TO or CRM_EMAIL_LIVE=1. Carries one-click unsubscribe headers.
 */
export async function sendFollowUpEmail(input: {
  clientId: string;
  step: number;
  to: string;
  token: string;
  email: { subject: string; html: string; text: string };
  settings: CrmSettings;
}): Promise<SendOutcome> {
  const { email, settings } = input;
  const live = process.env.NODE_ENV === "production" || process.env.CRM_EMAIL_LIVE === "1";
  const testTo = process.env.CRM_EMAIL_TEST_TO?.trim();
  if (!live && !testTo) {
    console.info(`[crm follow-up: logged, not sent] #${input.step} → ${input.to}\n  Subject: ${email.subject}\n${email.text.replace(/^/gm, "  | ")}`);
    return { logged: true, reason: "Dev: the email was logged to the server console, not sent. Set CRM_EMAIL_TEST_TO to send it to yourself." };
  }
  if (!crmEmailReady()) return { skipped: true, reason: "Email isn't set up: add RESEND_API_KEY and BOOKING_EMAIL_FROM." };
  const to = live ? input.to : testTo!;
  const unsub = `${appUrl()}/api/crm/unsubscribe?t=${input.token}`;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Idempotency-Key": `crm-followup/${input.clientId}/${input.step}`,
    },
    body: JSON.stringify({
      from: `${settings.from_name.replace(/[<>"]/g, "")} <${process.env.BOOKING_EMAIL_FROM}>`,
      to: [to],
      ...(settings.reply_to ? { reply_to: settings.reply_to } : {}),
      subject: live ? email.subject : `[test → ${input.to}] ${email.subject}`,
      html: email.html,
      text: email.text,
      headers: { "X-Entity-Ref-ID": `${input.clientId}-followup-${input.step}`, "List-Unsubscribe": `<${unsub}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return { sent: true, to };
}

export function describeOutcome(o: SendOutcome, verb = "Invite") {
  if ("sent" in o) return `${verb} emailed to ${o.to}.`;
  return o.reason;
}

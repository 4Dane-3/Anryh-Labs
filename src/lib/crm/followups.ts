import { DateTime } from "luxon";
import { clientFirstName } from "@/lib/crm/types";

// CRM follow-up emails: a check-in sequence staff start for a client. Pure (schedule and email content),
// shared by the server actions, the cron and the preview. Sending is in email.ts.

export const CADENCES = {
  daily: { label: "Daily", days: 1 },
  every_2_days: { label: "Every 48 hours", days: 2 },
  twice_monthly: { label: "Twice a month", days: 15 },
} as const;
export type Cadence = keyof typeof CADENCES;
export const isCadence = (v: unknown): v is Cadence => typeof v === "string" && v in CADENCES;

export type FollowUpStatus = "active" | "paused" | "stopped" | "finished";
export type CrmFollowUp = {
  client_id: string;
  cadence: Cadence;
  status: FollowUpStatus;
  stop_reason: string | null;
  max_emails: number;
  sent_count: number;
  next_send_at: string | null;
  last_sent_at: string | null;
  started_by: string | null;
  created_at: string;
};
export type CrmFollowUpEmail = { id: number; client_id: string; step: number; subject: string; to_email: string; outcome: "sent" | "logged" | "failed"; error: string | null; sent_at: string };

export type FollowUpCopy = {
  offer: string;
  process: string; // one step a line: "Title: what happens"
  ctaUrl: string | null;
  ctaLabel: string;
  postalAddress: string | null;
};

export const DEFAULT_OFFER = `We run your Meta ads and book roof inspections for you. Migz AI launches 15–20 image and video ads built for your area, cuts the losers and moves budget to the winners every day. Emma, our AI voice assistant, calls every new lead within seconds, checks they're a job you take, and books the inspection on your calendar.

Our guarantee: 8 booked inspections in your first 30 days, or you don't pay the Anryh Labs fee.`;

export const DEFAULT_PROCESS = `Launch: 15–20 image and video ads built for your area
Learn and cut: losing ads paused, budget moved to the winners
Call in seconds: an AI assistant phones every new lead right away
Qualify and book: only jobs you take land on your calendar
Follow up: reminders, a check-in call, reviews and referrals
Reach the neighbors: we mail the houses around every finished job`;

export const DEFAULT_CTA_LABEL = "Book a quick call";

/** Emails go out at this local hour (the CRM's timezone), on weekdays. */
export const SEND_HOUR = 9;

/**
 * When the next email goes: `days` after `from` (by the cadence), at 9:00 in the CRM's timezone, moved
 * to Monday when it lands on a weekend.
 */
export function nextSendAt(from: Date | number, cadence: Cadence, zone: string): Date {
  let d = DateTime.fromMillis(+from, { zone }).plus({ days: CADENCES[cadence].days }).set({ hour: SEND_HOUR, minute: 0, second: 0, millisecond: 0 });
  while (d.weekday > 5) d = d.plus({ days: 1 });
  return d.toJSDate();
}

/** The first send when staff don't send one right away: the next weekday morning at 9:00. */
export function firstMorning(now: Date | number, zone: string): Date {
  let d = DateTime.fromMillis(+now, { zone }).set({ hour: SEND_HOUR, minute: 0, second: 0, millisecond: 0 });
  if (d.toMillis() <= +now) d = d.plus({ days: 1 });
  while (d.weekday > 5) d = d.plus({ days: 1 });
  return d.toJSDate();
}

/** Why a sequence can't (or shouldn't) send to this client right now, or null when it can. */
export function blockedReason(c: { email: string | null; status: string; unsubscribed_at?: string | null }, hasUpcomingMeeting = false): string | null {
  if (!c.email) return "No email address";
  if (c.unsubscribed_at) return "They unsubscribed";
  if (c.status === "client") return "They're a client now";
  if (c.status === "lost") return "Marked lost";
  if (c.status === "meeting" || hasUpcomingMeeting) return "They have a meeting";
  return null;
}

// Each email in the sequence opens differently, so a daily cadence doesn't send the same thing twice.
// The offer and the process are in every one; the last one asks whether to keep in touch.
const STEPS = [
  {
    subject: (co: string) => `Quick recap for ${co}: booked roof inspections`,
    heading: "Catching you up",
    lead: (first: string, from: string) => `Hi ${first}, here's a quick recap of what we do at ${from}, all in one place.`,
  },
  {
    subject: () => "How we book inspections for roofers",
    heading: "How it works",
    lead: (first: string) => `Hi ${first}, following up with the short version of how we fill a roofer's calendar, from the first ad to the booked inspection.`,
  },
  {
    subject: () => "8 booked inspections in 30 days, or no fee",
    heading: "Our guarantee",
    lead: (first: string) => `Hi ${first}, the part most roofers ask about first: if we don't book 8 inspections that fit your rules in your first 30 days, you don't pay our fee.`,
  },
  {
    subject: (co: string) => `Still looking for more jobs at ${co}?`,
    heading: "Still a fit?",
    lead: (first: string) => `Hi ${first}, checking in. If more booked inspections would help this season, here's where we'd start.`,
  },
];
const LAST = {
  subject: () => "Should I keep in touch?",
  heading: "One last check-in",
  lead: (first: string) => `Hi ${first}, I don't want to crowd your inbox, so this is my last note for now. If the timing's better later, just reply "later" and I'll reach back out.`,
};

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const nl2br = (s: string) => esc(s).replace(/\r?\n/g, "<br />");
const INK = "#0f172a";
const BODY = "#334155";
const MUTED = "#64748b";
const LINE = "#e2e8f0";
const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

export function processSteps(process: string) {
  return process
    .split(/\r?\n/)
    .map((l) => l.trim().replace(/^[-•*\d.)\s]+/, ""))
    .filter(Boolean)
    .slice(0, 10)
    .map((l) => {
      const i = l.indexOf(":");
      return i > 0 && i < 60 ? { title: l.slice(0, i).trim(), body: l.slice(i + 1).trim() } : { title: l, body: "" };
    });
}

/**
 * Follow-up email number `step` (1-based) of `total`. The last one in the sequence is the "keep in touch?"
 * note; the others rotate through the openers above.
 */
export function followUpEmail(input: {
  step: number;
  total: number;
  from: string;
  client: { name: string | null; company: string | null };
  copy: FollowUpCopy;
  unsubscribeUrl: string;
}) {
  const { step, total, from, copy } = input;
  const first = clientFirstName(input.client) ?? "there";
  const co = input.client.company?.trim() || "your team";
  const s = step >= total && total > 1 ? LAST : STEPS[(step - 1) % STEPS.length];
  const subject = s.subject(co);
  const lead = s.lead(first, from);
  const steps = processSteps(copy.process);
  const offerParas = copy.offer.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const replyLine = copy.ctaUrl ? `Or just reply to this email with a good time.` : `Just reply to this email and we'll find a time.`;

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="color-scheme" content="light only" />
<title>${esc(subject)}</title>
</head>
<body style="margin:0;padding:0;background:#f8fafc;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(offerParas[0]?.slice(0, 140) ?? lead)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;">
  <tr>
    <td align="center" style="padding:32px 16px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid ${LINE};border-radius:16px;">
        <tr>
          <td style="padding:28px 28px 0;">
            <div style="font:600 14px/1 ${FONT};color:${MUTED};">${esc(from)}</div>
            <h1 style="margin:14px 0 0;font:700 26px/1.2 ${FONT};color:${INK};letter-spacing:-0.02em;">${esc(s.heading)}</h1>
            <p style="margin:12px 0 0;font:400 16px/1.6 ${FONT};color:${BODY};">${esc(lead)}</p>
          </td>
        </tr>
        <tr>
          <td style="padding:22px 28px 0;">
            <div style="font:600 12px/1 ${FONT};color:${MUTED};text-transform:uppercase;letter-spacing:0.06em;">What we do</div>
            ${offerParas.map((p, i) => `<p style="margin:${i ? 12 : 10}px 0 0;font:${/guarantee/i.test(p) ? 600 : 400} 15px/1.6 ${FONT};color:${/guarantee/i.test(p) ? INK : BODY};">${nl2br(p)}</p>`).join("")}
          </td>
        </tr>
        ${
          steps.length
            ? `<tr>
          <td style="padding:22px 28px 0;">
            <div style="font:600 12px/1 ${FONT};color:${MUTED};text-transform:uppercase;letter-spacing:0.06em;margin-bottom:10px;">How it works</div>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${LINE};border-radius:12px;">
              ${steps
                .map(
                  (st, i) => `<tr>
                <td width="40" valign="top" style="padding:14px 0 14px 16px;${i < steps.length - 1 ? `border-bottom:1px solid ${LINE};` : ""}">
                  <div style="width:24px;height:24px;border-radius:999px;background:${INK};color:#ffffff;font:700 12px/24px ${FONT};text-align:center;">${i + 1}</div>
                </td>
                <td style="padding:14px 16px 14px 8px;${i < steps.length - 1 ? `border-bottom:1px solid ${LINE};` : ""}">
                  <div style="font:600 15px/1.35 ${FONT};color:${INK};">${esc(st.title)}</div>
                  ${st.body ? `<div style="margin-top:3px;font:400 14px/1.5 ${FONT};color:${BODY};">${esc(st.body)}</div>` : ""}
                </td>
              </tr>`,
                )
                .join("")}
            </table>
          </td>
        </tr>`
            : ""
        }
        <tr>
          <td style="padding:24px 28px 0;">
            <p style="margin:0 0 16px;font:400 15px/1.6 ${FONT};color:${BODY};">Would it make sense to talk this week?</p>
            ${copy.ctaUrl ? `<a href="${esc(copy.ctaUrl)}" style="display:inline-block;padding:14px 26px;border-radius:999px;font:600 15px/1 ${FONT};text-decoration:none;background:${INK};color:#ffffff;">${esc(copy.ctaLabel)}</a>` : ""}
            <p style="margin:14px 0 0;font:400 14px/1.55 ${FONT};color:${MUTED};">${esc(replyLine)}</p>
          </td>
        </tr>
        <tr>
          <td style="padding:26px 28px 28px;">
            <div style="border-top:1px solid ${LINE};padding-top:18px;font:400 12px/1.6 ${FONT};color:#94a3b8;">
              You&rsquo;re getting this because you&rsquo;ve been in touch with ${esc(from)}. <a href="${esc(input.unsubscribeUrl)}" style="color:#94a3b8;">Unsubscribe</a>${copy.postalAddress ? `<br />${esc(copy.postalAddress)}` : ""}
            </div>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;

  const text = [
    s.heading,
    "",
    lead,
    "",
    "WHAT WE DO",
    ...offerParas.flatMap((p) => [p, ""]),
    steps.length ? "HOW IT WORKS" : "",
    ...steps.map((st, i) => `${i + 1}. ${st.title}${st.body ? `: ${st.body}` : ""}`),
    "",
    "Would it make sense to talk this week?",
    copy.ctaUrl ? `${copy.ctaLabel}: ${copy.ctaUrl}` : "",
    replyLine,
    "",
    "--",
    `Unsubscribe: ${input.unsubscribeUrl}`,
    copy.postalAddress ?? "",
  ]
    .filter((l, i, a) => l !== "" || a[i - 1] !== "")
    .join("\n");

  return { subject, html, text };
}

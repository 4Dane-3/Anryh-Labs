import { DateTime } from "luxon";
import { clientFirstName } from "@/lib/crm/types";

// The CRM's emails to a client: the meeting invite (with a big Confirm button), a nudge when it sits
// unconfirmed, the reminder the day before and the hour before, the cancellation, and the rebook email
// after a no-show. Pure: subject, HTML and text; email.ts sends them. Table layout and inline
// styles like the booking confirmation email, white and slate.

export type InviteKind = "invite" | "update" | "reminder" | "cancel" | "nudge" | "hour" | "rebook";

export type InviteInput = {
  kind: InviteKind;
  from: string; // the name it goes out under
  client: { name: string | null };
  meeting: { title: string; starts_at: string; ends_at: string; timezone: string; meeting_url: string | null; meeting_details: string | null; description: string | null; status: string };
  confirmUrl: string;
};

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const nl2br = (s: string) => esc(s).replace(/\r?\n/g, "<br />");

const INK = "#0f172a";
const BODY = "#334155";
const MUTED = "#64748b";
const LINE = "#e2e8f0";
const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

export function whenText(m: { starts_at: string; ends_at: string; timezone: string }) {
  const start = DateTime.fromISO(m.starts_at).setZone(m.timezone);
  const end = DateTime.fromISO(m.ends_at).setZone(m.timezone);
  return { day: start.toFormat("cccc, LLLL d"), time: `${start.toFormat("h:mm")}–${end.toFormat("h:mm a")} ${start.toFormat("ZZZZ")}`, short: `${start.toFormat("ccc, LLL d")} at ${start.toFormat("h:mm a ZZZZ")}` };
}

export function inviteEmail(input: InviteInput) {
  const { meeting: m, kind } = input;
  const first = clientFirstName(input.client) ?? "there";
  const w = whenText(m);
  const confirmed = m.status === "confirmed";
  const startTime = DateTime.fromISO(m.starts_at).setZone(m.timezone).toFormat("h:mm a");
  const when = `${m.title} · ${w.short}`;
  const subject = {
    invite: `${when} · please confirm`,
    update: `Updated: ${when}`,
    reminder: `Reminder: ${when}`,
    nudge: `Did this reach you? ${when}`,
    hour: `Starting at ${startTime}: ${m.title}`,
    cancel: `Cancelled: ${when}`,
    rebook: "Sorry we missed each other: let's find another time",
  }[kind];

  const heading = {
    invite: "You're invited.",
    update: "Your meeting has changed.",
    reminder: confirmed ? "See you soon." : "Can you still make it?",
    nudge: "Just checking this reached you.",
    hour: `We're on at ${startTime}.`,
    cancel: "This meeting is cancelled.",
    rebook: "Looks like we missed each other.",
  }[kind];

  const lead = {
    invite: `Hi ${first}, ${input.from} would like to meet with you. Press confirm to lock in the time.`,
    update: `Hi ${first}, ${input.from} would like to meet with you. Press confirm to lock in the time.`,
    reminder: confirmed
      ? `Hi ${first}, a reminder about your meeting with ${input.from}.`
      : `Hi ${first}, your meeting with ${input.from} is coming up. Press confirm so we know you'll be there.`,
    nudge: `Hi ${first}, tap Confirm so ${input.from} knows ${w.day} at ${startTime} still works for you.`,
    hour: `Hi ${first}, here's the link for your meeting with ${input.from}. Running late? Just reply to this email.`,
    cancel: `Hi ${first}, ${input.from} cancelled the meeting below. Reply to this email if you'd like to find another time.`,
    rebook: `Hi ${first}, we were set to meet ${w.short}. No worries, it happens. Pick another time that works for you and ${input.from} will set it up.`,
  }[kind];
  // Past the meeting (hour reminder, rebook) there's nothing to confirm; the other emails ask until they do
  const showConfirm = (kind === "invite" || kind === "update" || kind === "reminder" || kind === "nudge") && !confirmed;
  const past = kind === "rebook";
  const preheader = `${w.day}, ${w.time}.${showConfirm ? " Press confirm to lock it in." : ""}`;

  const button = (href: string, label: string, primary: boolean) =>
    `<a href="${esc(href)}" style="display:inline-block;padding:14px 26px;border-radius:999px;font:600 15px/1 ${FONT};text-decoration:none;${
      primary ? `background:${INK};color:#ffffff;` : `background:#ffffff;color:${INK};border:1px solid #cbd5e1;`
    }">${esc(label)}</a>`;

  const row = (label: string, body: string, last = false) => `<tr>
                <td style="padding:16px 18px;${last ? "" : `border-bottom:1px solid ${LINE};`}">
                  <div style="font:600 12px/1 ${FONT};color:${MUTED};text-transform:uppercase;letter-spacing:0.06em;">${label}</div>
                  <div style="margin-top:8px;">${body}</div>
                </td>
              </tr>`;

  const where = m.meeting_url
    ? `<a href="${esc(m.meeting_url)}" style="font:600 15px/1.45 ${FONT};color:${INK};word-break:break-all;">${esc(m.meeting_url)}</a>${
        m.meeting_details ? `<div style="margin-top:6px;font:400 14px/1.5 ${FONT};color:${BODY};">${nl2br(m.meeting_details)}</div>` : ""
      }`
    : m.meeting_details
      ? `<div style="font:400 15px/1.5 ${FONT};color:${BODY};">${nl2br(m.meeting_details)}</div>`
      : "";

  const rows = [
    row("When", `<div style="font:600 17px/1.35 ${FONT};color:${INK};">${esc(w.day)}</div><div style="font:400 15px/1.4 ${FONT};color:${BODY};">${esc(w.time)}</div>`, !where && !m.description),
    where && kind !== "cancel" && !past ? row("Where", where, !m.description || kind === "hour") : "",
    m.description && kind !== "cancel" && !past && kind !== "hour" ? row("About", `<div style="font:400 15px/1.5 ${FONT};color:${BODY};">${nl2br(m.description)}</div>`, true) : "",
  ].join("");

  const actions = showConfirm
    ? `<tr>
          <td style="padding:24px 28px 0;">
            ${button(input.confirmUrl, "Confirm I'll be there", true)}
            <p style="margin:14px 0 0;font:400 14px/1.55 ${FONT};color:${MUTED};">Can&rsquo;t make it? <a href="${esc(input.confirmUrl)}" style="color:${MUTED};">Let ${esc(input.from)} know</a> or reply to this email. The calendar invite is attached.</p>
          </td>
        </tr>`
    : kind === "rebook"
      ? `<tr>
          <td style="padding:24px 28px 0;">
            ${button(input.confirmUrl, "Pick another time", true)}
            <p style="margin:14px 0 0;font:400 14px/1.55 ${FONT};color:${MUTED};">Or just reply to this email with a few times that suit you.</p>
          </td>
        </tr>`
      : kind === "hour"
        ? `${m.meeting_url ? `<tr><td style="padding:24px 28px 0;">${button(m.meeting_url, "Join the meeting", true)}</td></tr>` : ""}<tr><td style="padding:16px 28px 0;"><p style="margin:0;font:400 14px/1.55 ${FONT};color:${MUTED};">Running late or can&rsquo;t make it? Reply to this email.</p></td></tr>`
        : kind !== "cancel"
          ? `<tr><td style="padding:22px 28px 0;"><p style="margin:0;font:400 14px/1.55 ${FONT};color:${MUTED};">You confirmed this meeting. Need to change it? Reply to this email.</p></td></tr>`
          : "";

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="color-scheme" content="light only" />
<title>${esc(subject)}</title>
</head>
<body style="margin:0;padding:0;background:#f8fafc;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;">
  <tr>
    <td align="center" style="padding:32px 16px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border:1px solid ${LINE};border-radius:16px;">
        <tr>
          <td style="padding:28px 28px 0;">
            <div style="font:600 14px/1 ${FONT};color:${MUTED};">${esc(input.from)}</div>
            <h1 style="margin:14px 0 0;font:700 28px/1.2 ${FONT};color:${INK};letter-spacing:-0.02em;">${esc(heading)}</h1>
            <p style="margin:12px 0 0;font:400 16px/1.55 ${FONT};color:${BODY};">${esc(lead)}</p>
          </td>
        </tr>
        <tr>
          <td style="padding:22px 28px 0;">
            <div style="font:600 16px/1.35 ${FONT};color:${INK};margin-bottom:10px;">${esc(m.title)}</div>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${LINE};border-radius:12px;">
              ${rows}
            </table>
          </td>
        </tr>
        ${actions}
        <tr>
          <td style="padding:26px 28px 28px;">
            <div style="border-top:1px solid ${LINE};padding-top:18px;font:400 12px/1.6 ${FONT};color:#94a3b8;">You&rsquo;re getting this email because ${esc(input.from)} scheduled a meeting with you.</div>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;

  const text = [
    heading,
    "",
    lead,
    "",
    m.title,
    `When: ${w.day}, ${w.time}`,
    m.meeting_url && kind !== "cancel" && !past ? `Join: ${m.meeting_url}` : "",
    m.meeting_details && kind !== "cancel" && !past ? m.meeting_details : "",
    m.description && kind !== "cancel" && !past && kind !== "hour" ? `\n${m.description}` : "",
    "",
    showConfirm ? `Confirm you'll be there: ${input.confirmUrl}` : "",
    past ? `Pick another time: ${input.confirmUrl}` : "",
    kind === "hour" ? "Running late or can't make it? Reply to this email." : past ? "Or reply with a few times that suit you." : "Need to change it? Reply to this email.",
  ]
    .filter((l, i, a) => l !== "" || a[i - 1] !== "")
    .join("\n");

  return { subject, html, text };
}

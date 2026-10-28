import { DateTime } from "luxon";

// The email a prospect gets the moment they book: the agent's photo, the confirmed time in the prospect's
// own timezone, and the two things worth doing next (add it to a calendar, help the agent prepare). Pure:
// builds the subject, HTML and plain text; email.ts sends it. Table layout and inline styles, because
// that's what email clients render reliably. White and slate, like the booking pages; no promises about
// coverage or price (insurance advertising rules apply to email too).

export type ConfirmationInput = {
  agent: { fullName: string; photoUrl: string | null; title: string | null; licenseNumber: string | null };
  prospect: { name: string; phone: string };
  startsAt: string; // ISO
  minutes: number;
  timezone: string; // the prospect's when known, else the agent's
  calendarUrl: string;
  prepareUrl: string;
  bookedOn: string; // the site they booked on, e.g. "foreignfinancial.org"
};

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function phone(e164: string) {
  const d = e164.replace(/\D/g, "");
  const n = d.length === 11 && d.startsWith("1") ? d.slice(1) : d;
  return n.length === 10 ? `(${n.slice(0, 3)}) ${n.slice(3, 6)}-${n.slice(6)}` : e164;
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");

const INK = "#0f172a";
const BODY = "#334155";
const MUTED = "#64748b";
const LINE = "#e2e8f0";
const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

export function confirmationEmail(input: ConfirmationInput) {
  const { agent, prospect } = input;
  const agentFirst = agent.fullName.split(" ")[0];
  const first = prospect.name.trim().split(/\s+/)[0] || "there";
  const start = DateTime.fromISO(input.startsAt).setZone(input.timezone);
  const end = start.plus({ minutes: input.minutes });
  const day = start.toFormat("cccc, LLLL d");
  const time = `${start.toFormat("h:mm")}–${end.toFormat("h:mm a")} ${start.toFormat("ZZZZ")}`;
  const subject = `You're booked with ${agent.fullName} · ${start.toFormat("ccc, LLL d")} at ${start.toFormat("h:mm a")}`;
  const preheader = `${day}, ${time}. ${agentFirst} will call you at ${phone(prospect.phone)}.`;

  const avatar = agent.photoUrl
    ? `<img src="${esc(agent.photoUrl)}" width="64" height="64" alt="${esc(agent.fullName)}" style="display:block;width:64px;height:64px;border-radius:32px;object-fit:cover;border:0;" />`
    : `<div style="width:64px;height:64px;border-radius:32px;background:#f1f5f9;color:${INK};font:600 22px/64px ${FONT};text-align:center;">${esc(initials(agent.fullName))}</div>`;

  const button = (href: string, label: string, primary: boolean) =>
    `<a href="${esc(href)}" style="display:inline-block;padding:13px 22px;border-radius:999px;font:600 15px/1 ${FONT};text-decoration:none;${
      primary ? `background:${INK};color:#ffffff;` : `background:#ffffff;color:${INK};border:1px solid #cbd5e1;`
    }">${esc(label)}</a>`;

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
            <table role="presentation" cellpadding="0" cellspacing="0">
              <tr>
                <td style="vertical-align:middle;">${avatar}</td>
                <td style="vertical-align:middle;padding-left:14px;">
                  <div style="font:600 17px/1.3 ${FONT};color:${INK};">${esc(agent.fullName)}</div>
                  <div style="font:400 14px/1.4 ${FONT};color:${MUTED};">${esc(agent.title || "Licensed life insurance agent")}</div>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding:28px 28px 0;">
            <h1 style="margin:0;font:700 28px/1.2 ${FONT};color:${INK};letter-spacing:-0.02em;">You&rsquo;re booked.</h1>
            <p style="margin:12px 0 0;font:400 16px/1.55 ${FONT};color:${BODY};">Hi ${esc(first)}, your free ${input.minutes}-minute call with ${esc(agentFirst)} is confirmed.</p>
          </td>
        </tr>
        <tr>
          <td style="padding:22px 28px 0;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${LINE};border-radius:12px;">
              <tr>
                <td style="padding:16px 18px;border-bottom:1px solid ${LINE};">
                  <div style="font:600 12px/1 ${FONT};color:${MUTED};text-transform:uppercase;letter-spacing:0.06em;">When</div>
                  <div style="margin-top:8px;font:600 17px/1.35 ${FONT};color:${INK};">${esc(day)}</div>
                  <div style="font:400 15px/1.4 ${FONT};color:${BODY};">${esc(time)}</div>
                </td>
              </tr>
              <tr>
                <td style="padding:16px 18px;">
                  <div style="font:600 12px/1 ${FONT};color:${MUTED};text-transform:uppercase;letter-spacing:0.06em;">How</div>
                  <div style="margin-top:8px;font:400 15px/1.45 ${FONT};color:${BODY};">${esc(agentFirst)} will call you at <span style="color:${INK};font-weight:600;white-space:nowrap;">${esc(phone(prospect.phone))}</span>.</div>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding:22px 28px 0;">
            <table role="presentation" cellpadding="0" cellspacing="0">
              <tr>
                <td style="padding:0 10px 10px 0;">${button(input.calendarUrl, "Add to my calendar", true)}</td>
                <td style="padding:0 0 10px;">${button(input.prepareUrl, `Help ${agentFirst} prepare`, false)}</td>
              </tr>
            </table>
            <p style="margin:6px 0 0;font:400 14px/1.55 ${FONT};color:${MUTED};">A few optional questions help ${esc(agentFirst)} come ready with options that fit you. Need a different time? Just reply to this email.</p>
          </td>
        </tr>
        <tr>
          <td style="padding:26px 28px 28px;">
            <div style="border-top:1px solid ${LINE};padding-top:18px;font:400 12px/1.6 ${FONT};color:#94a3b8;">
              The call is free, with no obligation. ${esc(agent.fullName)} is a licensed insurance agent${agent.licenseNumber ? ` (License #${esc(agent.licenseNumber)})` : ""}. Coverage and pricing depend on underwriting and aren&rsquo;t guaranteed.<br />
              You&rsquo;re getting this email because you booked a call on ${esc(input.bookedOn)}.
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
    `You're booked.`,
    ``,
    `Hi ${first}, your free ${input.minutes}-minute call with ${agent.fullName} is confirmed.`,
    ``,
    `When: ${day}, ${time}`,
    `How: ${agentFirst} will call you at ${phone(prospect.phone)}.`,
    ``,
    `Add to my calendar: ${input.calendarUrl}`,
    `Help ${agentFirst} prepare: ${input.prepareUrl}`,
    ``,
    `Need a different time? Just reply to this email.`,
    ``,
    `The call is free, with no obligation. ${agent.fullName} is a licensed insurance agent${agent.licenseNumber ? ` (License #${agent.licenseNumber})` : ""}.`,
  ].join("\n");

  return { subject, html, text };
}

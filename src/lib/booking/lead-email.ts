// The email an instant-form lead gets the moment their form arrives: thanks, the agent will call, and a
// button to book the free call at a time that suits them (the agent's page, on their partner site when they
// have one). Pure: builds the subject, HTML and plain text; email.ts sends it. Same look as the booking
// confirmation (table layout, inline styles, white and slate), and no promises about coverage or price.
// CAN-SPAM: the sender is named truthfully, the subject says what the email is, the footer says why they got
// it and carries the business's postal address and a working opt-out (reply, or the List-Unsubscribe header).

export type LeadEmailInput = {
  agent: { fullName: string; title: string | null; licenseNumber: string | null; email: string };
  prospect: { name: string };
  bookUrl: string;
  site: string; // where the button goes, e.g. "foreignfinancial.org"
  business: { name: string; postalAddress: string }; // who sends it, and where they can be reached by mail
};

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const INK = "#0f172a";
const BODY = "#334155";
const MUTED = "#64748b";
const LINE = "#e2e8f0";
const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

export function leadEmail(input: LeadEmailInput) {
  const first = input.prospect.name.split(/\s+/)[0] || "there";
  const agentFirst = input.agent.fullName.split(/\s+/)[0];
  const role = [input.agent.title || "Licensed insurance broker", input.agent.licenseNumber ? `License #${input.agent.licenseNumber}` : null].filter(Boolean).join(" · ");
  const subject = `Thanks for your quote request, ${first}`;

  const text = [
    `Hi ${first},`,
    "",
    `Thanks for asking about life insurance. I'll give you a call soon to go over your options.`,
    "",
    `Would you rather pick a time that suits you? Book your free call here: ${input.bookUrl}`,
    "",
    "It's a free, no-pressure chat. You decide what, if anything, makes sense.",
    "",
    `${input.agent.fullName}`,
    role,
    "",
    "---",
    `You're getting this because you asked ${agentFirst} for a life insurance quote on Facebook or Instagram.`,
    `To stop emails, reply "unsubscribe" or write to ${input.agent.email}.`,
    `${input.business.name} · ${input.business.postalAddress}`,
  ].join("\n");

  const html = `<!doctype html>
<html><body style="margin:0;padding:0;background:#f8fafc;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;padding:32px 16px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border:1px solid ${LINE};border-radius:16px;">
<tr><td style="padding:32px 32px 8px;font-family:${FONT};">
<p style="margin:0 0 16px;font-size:20px;font-weight:600;color:${INK};">Hi ${esc(first)},</p>
<p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:${BODY};">Thanks for asking about life insurance. I'll give you a call soon to go over your options.</p>
<p style="margin:0 0 24px;font-size:16px;line-height:1.6;color:${BODY};">Would you rather pick a time that suits you?</p>
<table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="border-radius:999px;background:${INK};">
<a href="${esc(input.bookUrl)}" style="display:inline-block;padding:14px 28px;font-family:${FONT};font-size:16px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:999px;">Book your free call</a>
</td></tr></table>
<p style="margin:24px 0 0;font-size:15px;line-height:1.6;color:${BODY};">It's a free, no-pressure chat. You decide what, if anything, makes sense.</p>
</td></tr>
<tr><td style="padding:24px 32px 32px;font-family:${FONT};">
<p style="margin:0;font-size:15px;font-weight:600;color:${INK};">${esc(input.agent.fullName)}</p>
<p style="margin:4px 0 0;font-size:13px;color:${MUTED};">${esc(role)}</p>
</td></tr>
</table>
<p style="max-width:520px;margin:16px auto 0;font-family:${FONT};font-size:12px;line-height:1.5;color:${MUTED};">You're getting this because you asked ${esc(agentFirst)} for a life insurance quote on Facebook or Instagram. The button opens ${esc(input.site)}.<br>To stop emails, reply &ldquo;unsubscribe&rdquo; or write to <a href="mailto:${esc(input.agent.email)}?subject=Unsubscribe" style="color:${MUTED};">${esc(input.agent.email)}</a>.<br>${esc(input.business.name)} · ${esc(input.business.postalAddress)}</p>
</td></tr>
</table>
</body></html>`;

  return { subject, html, text };
}

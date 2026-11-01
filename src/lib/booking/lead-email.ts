// The email an instant-form lead gets the moment their form arrives: thanks, the agent will call, and a
// link to book the free call at a time that suits them (the agent's page, on their partner site when they
// have one). Pure: builds the subject, HTML and plain text; email.ts sends it. It reads like a note from
// the agent, not a newsletter: plain paragraphs, a plain link, no card, button or images, because Gmail
// files designed, button-led mail under Promotions and this one should land in the inbox. No promises
// about coverage or price.
// CAN-SPAM: the sender is named truthfully, the subject says what the email is, the footer says why they got
// it and carries the business's postal address and a working opt-out (reply "unsubscribe").

export type LeadEmailInput = {
  agent: { fullName: string; title: string | null; licenseNumber: string | null; email: string };
  prospect: { name: string };
  bookUrl: string;
  bookPage: string; // the link's visible text, e.g. "foreignfinancial.org/miguel-cruz"
  business: { name: string; postalAddress: string }; // who sends it, and where they can be reached by mail
};

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

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
    `If you'd rather pick a time that suits you, you can book your free call here: ${input.bookUrl}`,
    "",
    "It's a free, no-pressure chat. You decide what, if anything, makes sense.",
    "",
    input.agent.fullName,
    role,
    "",
    `You're getting this because you asked ${agentFirst} for a life insurance quote on Facebook or Instagram. To stop emails, reply "unsubscribe". ${input.business.name}, ${input.business.postalAddress}`,
  ].join("\n");

  const p = "margin:0 0 14px;";
  const html = `<!doctype html>
<html><body style="margin:0;padding:0;">
<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#222222;max-width:560px;padding:8px;">
<p style="${p}">Hi ${esc(first)},</p>
<p style="${p}">Thanks for asking about life insurance. I'll give you a call soon to go over your options.</p>
<p style="${p}">If you'd rather pick a time that suits you, you can book your free call here:<br><a href="${esc(input.bookUrl)}">${esc(input.bookPage)}</a></p>
<p style="${p}">It's a free, no-pressure chat. You decide what, if anything, makes sense.</p>
<p style="${p}">${esc(input.agent.fullName)}<br>${esc(role)}</p>
<p style="margin:24px 0 0;font-size:12px;color:#777777;">You're getting this because you asked ${esc(agentFirst)} for a life insurance quote on Facebook or Instagram. To stop emails, reply &ldquo;unsubscribe&rdquo;. ${esc(input.business.name)}, ${esc(input.business.postalAddress)}</p>
</div>
</body></html>`;

  return { subject, html, text };
}

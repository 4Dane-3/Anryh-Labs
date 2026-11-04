// The emails a lead gets from their agent: the moment their form arrives (thanks, the agent will call, and a
// link to book the free call at a time that suits them), and the agent's automated emails after they tap
// "Tried to call" or "Sent an email" (written by the agent, email-sequences.ts; followups.ts decides when). The link opens the agent's page, on their
// partner site when they have one. Pure: builds the subject, HTML and plain text; email.ts sends them. They
// read like a note from the agent, not a newsletter: plain paragraphs, a plain link, no card, button or
// images, because Gmail files designed, button-led mail under Promotions and these should land in the inbox.
// No promises about coverage or price.
// CAN-SPAM: the sender is named truthfully, the subject says what the email is, the footer says why they got
// it and carries the business's postal address and a working opt-out (reply "unsubscribe").

import { fillPlaceholders } from "@/lib/email-sequences";

export type LeadEmailInput = {
  agent: { fullName: string; title: string | null; licenseNumber: string | null; email: string };
  prospect: { name: string };
  bookUrl: string;
  bookPage: string; // the link's visible text, e.g. "foreignfinancial.org/miguel-cruz"
  business: { name: string; postalAddress: string }; // who sends it, and where they can be reached by mail
  /** How they reached the agent, for the footer: an instant form (the default), a quote request, or a booked call. */
  via?: "instant_form" | "page" | "booking";
};

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** One plain note: a greeting, paragraphs, the booking link, more paragraphs, the agent's sign-off and the footer. */
function plainNote(input: LeadEmailInput, subject: string, before: string[], linkLead: string, after: string[]) {
  const first = input.prospect.name.split(/\s+/)[0] || "there";
  const agentFirst = input.agent.fullName.split(/\s+/)[0];
  const role = [input.agent.title || "Licensed insurance broker", input.agent.licenseNumber ? `License #${input.agent.licenseNumber}` : null].filter(Boolean).join(" · ");
  const why =
    input.via === "booking"
      ? `booked a call with ${agentFirst}`
      : `asked ${agentFirst} for a life insurance quote${input.via === "page" ? "" : " on Facebook or Instagram"}`;
  const footer = `You're getting this because you ${why}. To stop emails, reply "unsubscribe". ${input.business.name}, ${input.business.postalAddress}`;

  const text = [`Hi ${first},`, ...before, `${linkLead} ${input.bookUrl}`, ...after, `${input.agent.fullName}\n${role}`, footer].join("\n\n");

  const p = "margin:0 0 14px;";
  const para = (s: string) => `<p style="${p}">${esc(s)}</p>`;
  const html = `<!doctype html>
<html><body style="margin:0;padding:0;">
<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#222222;max-width:560px;padding:8px;">
${para(`Hi ${first},`)}
${before.map(para).join("\n")}
<p style="${p}">${esc(linkLead)}<br><a href="${esc(input.bookUrl)}">${esc(input.bookPage)}</a></p>
${after.map(para).join("\n")}
<p style="${p}">${esc(input.agent.fullName)}<br>${esc(role)}</p>
<p style="margin:24px 0 0;font-size:12px;color:#777777;">${esc(footer).replace(/&quot;unsubscribe&quot;/, "&ldquo;unsubscribe&rdquo;")}</p>
</div>
</body></html>`;

  return { subject, html, text };
}

/** The moment an instant-form lead arrives. */
export function leadEmail(input: LeadEmailInput) {
  const first = input.prospect.name.split(/\s+/)[0] || "there";
  return plainNote(
    input,
    `Thanks for your quote request, ${first}`,
    ["Thanks for asking about life insurance. I'll give you a call soon to go over your options."],
    "If you'd rather pick a time that suits you, you can book your free call here:",
    ["It's a free, no-pressure chat. You decide what, if anything, makes sense."],
  );
}

const LINK_TOKEN = "\u0000link\u0000";

/**
 * One email of the agent's own sequence (email-sequences.ts): their subject and body with the placeholders
 * filled, paragraphs split on blank lines. {booking_link} becomes the link; a body without it gets a closing
 * line with the link, so every email offers a time. Their name, title and the footer go on the end.
 */
export function sequenceEmail(input: LeadEmailInput, email: { subject: string; body: string }) {
  const firstName = input.prospect.name.split(/\s+/)[0] || "there";
  const v = { firstName, yourName: input.agent.fullName };
  const subject = fillPlaceholders(email.subject, { ...v, link: input.bookPage }).replace(/\s+/g, " ").trim();
  const paras = email.body.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  if (!email.body.includes("{booking_link}")) paras.push("Pick a time that suits you: {booking_link}");

  const agentFirst = input.agent.fullName.split(/\s+/)[0];
  const role = [input.agent.title || "Licensed insurance broker", input.agent.licenseNumber ? `License #${input.agent.licenseNumber}` : null].filter(Boolean).join(" · ");
  const why = input.via === "booking" ? `booked a call with ${agentFirst}` : `asked ${agentFirst} for a life insurance quote${input.via === "page" ? "" : " on Facebook or Instagram"}`;
  const footer = `You're getting this because you ${why}. To stop emails, reply "unsubscribe". ${input.business.name}, ${input.business.postalAddress}`;

  const text = [...paras.map((p) => fillPlaceholders(p, { ...v, link: input.bookUrl })), `${input.agent.fullName}\n${role}`, footer].join("\n\n");
  const p = "margin:0 0 14px;";
  const link = `<a href="${esc(input.bookUrl)}">${esc(input.bookPage)}</a>`;
  const para = (s: string) => `<p style="${p}">${esc(fillPlaceholders(s, { ...v, link: LINK_TOKEN })).replace(/\n/g, "<br>").replaceAll(LINK_TOKEN, link)}</p>`;
  const html = `<!doctype html>
<html><body style="margin:0;padding:0;">
<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#222222;max-width:560px;padding:8px;">
${paras.map(para).join("\n")}
<p style="${p}">${esc(input.agent.fullName)}<br>${esc(role)}</p>
<p style="margin:24px 0 0;font-size:12px;color:#777777;">${esc(footer).replace(/&quot;unsubscribe&quot;/, "&ldquo;unsubscribe&rdquo;")}</p>
</div>
</body></html>`;
  return { subject, html, text };
}

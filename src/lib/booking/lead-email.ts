// The emails a lead gets from their agent: the moment their form arrives (thanks, the agent will call, and a
// link to book the free call at a time that suits them), and, when the agent turns it on, after a call that
// didn't get through ("sorry I missed you", with the same link) and up to 3 follow-ups 48 hours apart to a
// lead they haven't reached (followups.ts decides when). The link opens the agent's page, on their
// partner site when they have one. Pure: builds the subject, HTML and plain text; email.ts sends them. They
// read like a note from the agent, not a newsletter: plain paragraphs, a plain link, no card, button or
// images, because Gmail files designed, button-led mail under Promotions and these should land in the inbox.
// No promises about coverage or price.
// CAN-SPAM: the sender is named truthfully, the subject says what the email is, the footer says why they got
// it and carries the business's postal address and a working opt-out (reply "unsubscribe").

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

/** How many 48-hour follow-ups a lead gets at most; the last one says it's the last. */
export const MAX_FOLLOWUPS = 3;

// Each follow-up says something different (the same words three times reads as automated), shorter as they
// go, and the last one says it's the last, so it never feels like a drip campaign
const FOLLOWUPS: { subject: (first: string) => string; before: string[]; linkLead: string }[] = [
  {
    subject: (first) => `Following up, ${first}`,
    before: ["I wanted to follow up on your life insurance quote request. I'd still like to help you find an option that fits."],
    linkLead: "Pick a time that works for you and I'll call then:",
  },
  {
    subject: (first) => `Still thinking it over, ${first}?`,
    before: ["I know things get busy. If you still have questions about coverage, a short call is usually the quickest way to get answers."],
    linkLead: "Here's my calendar if a call would help:",
  },
  {
    subject: (first) => `One last note, ${first}`,
    before: ["I don't want to fill up your inbox, so this is my last follow-up. If the timing isn't right, no problem at all."],
    linkLead: "If you'd like to talk later, this link stays open:",
  },
];

/** The nth 48-hour follow-up (1 to MAX_FOLLOWUPS) to a lead the agent hasn't reached. */
export function followUpEmail(input: LeadEmailInput, n: number) {
  const first = input.prospect.name.split(/\s+/)[0] || "there";
  const f = FOLLOWUPS[Math.min(Math.max(n, 1), MAX_FOLLOWUPS) - 1];
  return plainNote(input, f.subject(first), f.before, f.linkLead, []);
}

/** After the agent logs a call that didn't get through, when they've turned it on. `message` is their own optional line. */
export function triedCallEmail(input: LeadEmailInput & { message?: string | null }) {
  const first = input.prospect.name.split(/\s+/)[0] || "there";
  const about = input.via === "booking" ? "our call" : "your life insurance quote";
  return plainNote(
    input,
    `Sorry I missed you, ${first}`,
    [`I just tried calling you about ${about}, but couldn't reach you.`, ...(input.message?.trim() ? [input.message.trim()] : [])],
    "If it's easier, pick a time that suits you and I'll call you then:",
    ["It's a free, no-pressure chat. You decide what, if anything, makes sense."],
  );
}

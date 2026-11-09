import { displayPhone } from "@/lib/booking/call";
import { dollars } from "@/lib/voice/checkin-rules";

// The post-job emails, built pure for the tests: the customer's referral invite, the roofer's alerts (a problem
// on the check-in call, new referrals, a gift card owed) and the optional one-time intro to a referred person.

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const first = (name: string) => name.trim().split(/\s+/)[0] || "there";

const shell = (body: string) => `<!doctype html><html><body style="margin:0;background:#f8fafc;padding:24px 12px;font-family:${FONT};color:#0f172a;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:16px;">${body}</table></body></html>`;
const p = (text: string, style = "") => `<p style="margin:12px 0 0;font:400 15px/1.55 ${FONT};color:#334155;${style}">${text}</p>`;
const button = (href: string, label: string) =>
  `<a href="${esc(href)}" style="display:inline-block;margin-top:18px;padding:13px 22px;border-radius:999px;background:#1d4ed8;color:#fff;font:600 15px/1 ${FONT};text-decoration:none;">${esc(label)}</a>`;
const rowsTable = (rows: [string, string][]) =>
  `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:12px;margin-top:16px;">${rows
    .map(([k, v], i) => `<tr><td style="padding:10px 14px;${i ? "border-top:1px solid #e2e8f0;" : ""}font:600 12px/1.3 ${FONT};color:#64748b;text-transform:uppercase;letter-spacing:.05em;width:120px;vertical-align:top;">${esc(k)}</td><td style="padding:10px 14px;${i ? "border-top:1px solid #e2e8f0;" : ""}font:400 15px/1.4 ${FONT};">${esc(v)}</td></tr>`)
    .join("")}</table>`;

export type InviteInput = {
  company: string;
  customerName: string;
  link: string;
  rewardCents: number;
  goal: number;
  /** The roofer's Google review link, when they've set one. */
  reviewUrl?: string | null;
  /** after_call: they told the assistant the job went well. no_call: sent instead of a call. */
  variant: "after_call" | "no_call";
};

/** The customer's thank-you: a Google review link (when set) and their referral link to /r/{token}. */
export function referralInviteEmail(i: InviteInput) {
  const reward = i.rewardCents > 0 ? `a ${dollars(i.rewardCents)} gift card` : null;
  const offer = reward
    ? `Refer ${i.goal} friends or neighbors who might need roofing work and we'll send you ${reward} to any store you choose.`
    : `If you know anyone who might need a roofer, we'd be grateful for the introduction.`;
  const opener =
    i.variant === "after_call"
      ? `Thanks for talking with us, and for choosing ${i.company}. We're glad the job went well.`
      : `Thanks for choosing ${i.company}. We hope everything with your roof went well. If anything isn't right, just reply to this email and we'll make it right.`;
  const review = i.reviewUrl ? `If you have a minute, we'd love to hear about your experience in a Google review. It helps other homeowners find a roofer they can trust.` : null;
  const subject = reward ? `Thank you from ${i.company}, plus a ${dollars(i.rewardCents)} gift card` : `Thank you from ${i.company}`;
  const html = shell(`<tr><td style="padding:26px 26px 24px;">
<h1 style="margin:0;font:700 22px/1.3 ${FONT};">Hi ${esc(first(i.customerName))},</h1>
${p(esc(opener))}
${
  review && i.reviewUrl
    ? `${p(esc(review))}${button(i.reviewUrl, "Leave a Google review")}`
    : ""
}
<p style="margin:${review ? "26px" : "12px"} 0 0;font:400 15px/1.55 ${FONT};color:#334155;">${esc(offer)}</p>
${p("It takes a minute: add their name, phone and address, and our team will give them a call. We'll only contact them about roofing.", "color:#64748b;font-size:14px;")}
${button(i.link, reward ? "Refer friends" : "Refer someone")}
<p style="margin:22px 0 0;border-top:1px solid #e2e8f0;padding-top:14px;font:400 12px/1.6 ${FONT};color:#94a3b8;">${esc(i.company)} · Reply to this email to reach us.</p>
</td></tr>`);
  const text = [`Hi ${first(i.customerName)},`, "", opener, "", ...(review && i.reviewUrl ? [review, `Leave a Google review: ${i.reviewUrl}`, ""] : []), offer, `Refer friends: ${i.link}`, "", `${i.company} · Reply to this email to reach us.`].join("\n");
  return { subject, html, text };
}

/** To the roofer, right away: the customer raised a problem on the check-in call. */
export function issueAlertEmail(i: { customerName: string; phone: string; address: string | null; rating: number | null; details: string; jobDate: string | null }) {
  const subject = `Check-in: ${i.customerName} raised a problem${i.rating ? ` (${i.rating}/5)` : ""}`;
  const rows: [string, string][] = [
    ["Customer", i.customerName],
    ["Phone", displayPhone(i.phone)],
    ["Address", i.address ?? "Not given"],
    ["Rating", i.rating ? `${i.rating} out of 5` : "Not given"],
    ["What they said", i.details || "See the call summary in your dashboard."],
  ];
  if (i.jobDate) rows.splice(3, 0, ["Job", i.jobDate]);
  const html = shell(`<tr><td style="padding:26px 26px 24px;">
<h1 style="margin:0;font:700 22px/1.3 ${FONT};">A customer isn't happy</h1>
${p("Your AI assistant just called to check in after the job. They raised a problem, so no referral offer was made. A quick call from you now usually turns it around.")}
${rowsTable(rows)}
</td></tr>`);
  const text = [subject, "", ...rows.map(([k, v]) => `${k}: ${v}`)].join("\n");
  return { subject, html, text };
}

export type NewReferral = { name: string; phone: string; email: string | null; address: string | null };

/** To the roofer: a customer referred people (to call by hand: they were never AI-called or texted). */
export function referralsAddedEmail(i: { customerName: string; referrals: NewReferral[]; total: number; goal: number; dashboardUrl: string }) {
  const n = i.referrals.length;
  const subject = `${i.customerName} referred ${n} ${n === 1 ? "person" : "people"}`;
  const list = i.referrals
    .map((r) => `<tr><td style="padding:10px 14px;border-top:1px solid #e2e8f0;font:400 15px/1.45 ${FONT};"><b>${esc(r.name)}</b> · ${esc(displayPhone(r.phone))}${r.email ? ` · ${esc(r.email)}` : ""}${r.address ? `<br><span style="color:#64748b;">${esc(r.address)}</span>` : ""}</td></tr>`)
    .join("");
  const html = shell(`<tr><td style="padding:26px 26px 6px;">
<h1 style="margin:0;font:700 22px/1.3 ${FONT};">New referrals from ${esc(i.customerName)}</h1>
${p(`Give them a call. They haven't asked to be contacted themselves, so they're never called by the AI assistant or texted automatically: your team calls them by hand. ${esc(i.customerName)} has referred ${i.total} of ${i.goal}.`)}
</td></tr>
<tr><td style="padding:10px 26px 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-top:0;border-radius:12px;">${list}</table></td></tr>
<tr><td style="padding:4px 26px 24px;">${button(i.dashboardUrl, "Open referrals")}</td></tr>`);
  const text = [subject, "", ...i.referrals.map((r) => `${r.name} · ${displayPhone(r.phone)}${r.email ? ` · ${r.email}` : ""}${r.address ? ` · ${r.address}` : ""}`), "", `Call them by hand (never AI-called or texted). ${i.dashboardUrl}`].join("\n");
  return { subject, html, text };
}

/** To the roofer: a customer reached the goal and is owed a gift card. */
export function giftCardOwedEmail(i: { customerName: string; email: string | null; phone: string; cents: number; goal: number; dashboardUrl: string }) {
  const subject = `${i.customerName} earned a ${dollars(i.cents)} gift card`;
  const html = shell(`<tr><td style="padding:26px 26px 24px;">
<h1 style="margin:0;font:700 22px/1.3 ${FONT};">Gift card owed: ${esc(dollars(i.cents))}</h1>
${p(`${esc(i.customerName)} referred ${i.goal} people. Send them a ${esc(dollars(i.cents))} gift card to the store of their choice, then mark it sent in your dashboard.`)}
${rowsTable([["Customer", i.customerName], ["Email", i.email ?? "Not given"], ["Phone", displayPhone(i.phone)]])}
${button(i.dashboardUrl, "Open gift cards owed")}
</td></tr>`);
  const text = [subject, "", `${i.customerName} referred ${i.goal} people.`, `Email: ${i.email ?? "Not given"}`, `Phone: ${displayPhone(i.phone)}`, "", i.dashboardUrl].join("\n");
  return { subject, html, text };
}

/** The optional one plain email to a referred person. Has the sender's postal address (CAN-SPAM) and an opt-out. */
export function referralIntroEmail(i: { company: string; customerName: string; referralName: string; bookUrl: string; mailingAddress: string }) {
  const subject = `${first(i.customerName)} thought you might need a roofer`;
  const body = `${first(i.customerName)} recently had work done by ${i.company} and thought you might want a free roof inspection too.`;
  const html = shell(`<tr><td style="padding:26px 26px 24px;">
<h1 style="margin:0;font:700 22px/1.3 ${FONT};">Hi ${esc(first(i.referralName))},</h1>
${p(esc(body))}
${p("No pressure. If it would help, you can pick a time for a free, no-obligation inspection here:")}
${button(i.bookUrl, "Book a free inspection")}
<p style="margin:22px 0 0;border-top:1px solid #e2e8f0;padding-top:14px;font:400 12px/1.6 ${FONT};color:#94a3b8;">${esc(i.company)} · ${esc(i.mailingAddress)}<br>This is the only email we'll send unless you reply. Reply "unsubscribe" and we won't email you again.</p>
</td></tr>`);
  const text = [`Hi ${first(i.referralName)},`, "", body, "", `Book a free inspection: ${i.bookUrl}`, "", `${i.company} · ${i.mailingAddress}`, `This is the only email we'll send unless you reply. Reply "unsubscribe" and we won't email you again.`].join("\n");
  return { subject, html, text };
}

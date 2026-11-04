// Automated emails: what a lead gets after the agent taps "Tried to call" or "Sent an email". The agent writes
// each email (subject and body) in the Automated emails tab, chooses how many there are and how long after
// the last one each goes out. Pure (client-safe), so the editor, the sender and the tests share the rules.
// Placeholders: {first_name} (the lead's), {your_name}, {booking_link}. The agent's name and title, and the
// unsubscribe line with the business address (CAN-SPAM), are always added at the bottom.

export type SequenceKey = "tried_call" | "emailed";
export type SequenceEmail = {
  subject: string;
  body: string;
  /** Days after the tap (for the first email) or after the previous email. 0 = right away, first email only. */
  afterDays: number;
};
export type Sequence = { on: boolean; emails: SequenceEmail[] };
export type EmailSequences = Record<SequenceKey, Sequence>;

export const SEQUENCES: { key: SequenceKey; title: string; trigger: string }[] = [
  { key: "tried_call", title: "After a missed call", trigger: "Starts when you tap Tried to call" },
  { key: "emailed", title: "After you email them", trigger: "Starts when you tap Sent an email" },
];

export const MAX_EMAILS = 6;
export const MAX_AFTER_DAYS = 30;
export const MAX_SUBJECT = 120;
export const MAX_BODY = 3000;
export const PLACEHOLDERS = ["{first_name}", "{your_name}", "{booking_link}"] as const;

const LAST_NOTE = "I don't want to fill up your inbox, so this is my last follow-up. If the timing isn't right, no problem at all.\n\nIf you'd like to talk later, this link stays open: {booking_link}";

/** The emails every agent starts with. `message` is the old one-line addition to the missed-call email. */
export function defaultSequences(message?: string | null): EmailSequences {
  const extra = message?.trim() ? `\n\n${message.trim()}` : "";
  return {
    tried_call: {
      on: true,
      emails: [
        {
          afterDays: 0,
          subject: "Sorry I missed you, {first_name}",
          body: `Hi {first_name},\n\nI just tried calling you about life insurance, but couldn't reach you.${extra}\n\nIf it's easier, pick a time that suits you and I'll call you then: {booking_link}\n\nIt's a free, no-pressure chat. You decide what, if anything, makes sense.`,
        },
        {
          afterDays: 2,
          subject: "Following up, {first_name}",
          body: "Hi {first_name},\n\nI wanted to follow up on your life insurance quote request. I'd still like to help you find an option that fits.\n\nPick a time that works for you and I'll call then: {booking_link}",
        },
        {
          afterDays: 2,
          subject: "Still thinking it over, {first_name}?",
          body: "Hi {first_name},\n\nI know things get busy. If you still have questions about coverage, a short call is usually the quickest way to get answers.\n\nHere's my calendar if a call would help: {booking_link}",
        },
        { afterDays: 2, subject: "One last note, {first_name}", body: `Hi {first_name},\n\n${LAST_NOTE}` },
      ],
    },
    emailed: {
      on: true,
      emails: [
        {
          afterDays: 2,
          subject: "Following up, {first_name}",
          body: "Hi {first_name},\n\nI sent you a note a couple of days ago about life insurance and wanted to make sure it reached you. I'd still like to help you find an option that fits.\n\nPick a time that works for you and I'll call then: {booking_link}",
        },
        {
          afterDays: 3,
          subject: "Still thinking it over, {first_name}?",
          body: "Hi {first_name},\n\nIf you still have questions about coverage, a short call is usually the quickest way to get answers.\n\nHere's my calendar if a call would help: {booking_link}",
        },
        { afterDays: 4, subject: "One last note, {first_name}", body: `Hi {first_name},\n\n${LAST_NOTE}` },
      ],
    },
  };
}

const str = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\r\n/g, "\n").trim().slice(0, max) : "");

/** One sequence from untrusted input (the editor, or a stored row), or an error in the agent's words. */
export function cleanSequence(raw: unknown, fallback: Sequence): Sequence | string {
  const r = (raw ?? {}) as { on?: unknown; emails?: unknown };
  const list = Array.isArray(r.emails) ? r.emails : fallback.emails;
  if (!list.length) return "Keep at least one email, or turn this sequence off.";
  if (list.length > MAX_EMAILS) return `Up to ${MAX_EMAILS} emails in a sequence.`;
  const emails: SequenceEmail[] = [];
  for (const [i, e] of list.entries()) {
    const x = (e ?? {}) as Record<string, unknown>;
    const subject = str(x.subject, MAX_SUBJECT);
    const body = str(x.body, MAX_BODY);
    const days = Math.round(Number(x.afterDays));
    if (!subject) return `Email ${i + 1} needs a subject.`;
    if (!body) return `Email ${i + 1} needs a message.`;
    if (!Number.isFinite(days) || days < (i === 0 ? 0 : 1) || days > MAX_AFTER_DAYS)
      return i === 0 ? `Send email 1 right away or up to ${MAX_AFTER_DAYS} days later.` : `Email ${i + 1} goes 1 to ${MAX_AFTER_DAYS} days after the one before.`;
    emails.push({ subject, body, afterDays: days });
  }
  return { on: r.on === undefined ? fallback.on : !!r.on, emails };
}

/** The agent's sequences, falling back to the defaults for anything missing or broken. */
export function sequencesFor(agent: { email_sequences?: unknown; followup_message?: string | null }): EmailSequences {
  const defaults = defaultSequences(agent.followup_message);
  const stored = (agent.email_sequences ?? {}) as Partial<Record<SequenceKey, unknown>>;
  const pick = (k: SequenceKey) => {
    if (!stored[k]) return defaults[k];
    const s = cleanSequence(stored[k], defaults[k]);
    return typeof s === "string" ? defaults[k] : s;
  };
  return { tried_call: pick("tried_call"), emailed: pick("emailed") };
}

const DAY_MS = 86_400_000;

/**
 * When the next email of a sequence is due: `sent` emails have gone out, the last at `lastAt` (the tap, before
 * any). Null when the sequence is finished.
 */
export function nextDueAt(seq: Sequence, sent: number, lastAt: string) {
  const next = seq.emails[sent];
  return next ? new Date(Date.parse(lastAt) + next.afterDays * DAY_MS) : null;
}

/** How long after the tap a sequence can still send (its full length plus a week of slack for quiet hours). */
export const sequenceWindowDays = (seq: Sequence) => seq.emails.reduce((d, e) => d + e.afterDays, 0) + 7;

/** "Right away" / "1 day later" / "3 days later": when an email goes out, for the editor and the card. */
export const whenLabel = (days: number, first: boolean) => (days === 0 ? "Right away" : `${days} day${days === 1 ? "" : "s"} after ${first ? "you tap" : "the last email"}`);

/** Fills the placeholders. `link` replaces {booking_link} (the HTML renderer passes a token instead). */
export function fillPlaceholders(text: string, v: { firstName: string; yourName: string; link: string }) {
  return text.replaceAll("{first_name}", v.firstName).replaceAll("{your_name}", v.yourName).replaceAll("{booking_link}", v.link);
}

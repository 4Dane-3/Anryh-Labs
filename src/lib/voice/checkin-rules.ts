import { DateTime } from "luxon";
import { usPhone } from "@/lib/booking/call";
import { CALL_END_HOUR, CALL_START_HOUR, firstNameOf, inCallWindow } from "@/lib/voice/rules";

// The post-job check-in's rules, kept pure for the tests: when the call goes out, whether the customer's consent
// covers an AI call, what the agent is told, how the call's outcome is read, and the referral page's rows.

export const CHECKIN_DELAY_MS = 2 * 60 * 60_000; // about 2 hours after the job is marked done
export const CHECKIN_MORNING_HOUR = 10; // outside 8am–8pm: the next morning around 10am
export const CHECKIN_MAX_ATTEMPTS = 2; // the call, and one retry the next day

/** When the check-in call goes out: 2 hours after the job, if that's inside 8am–8pm in `tz`, else the next 10am. */
export function checkinTime(tz: string, doneAt: Date = new Date()): Date {
  const at = new Date(doneAt.getTime() + CHECKIN_DELAY_MS);
  if (inCallWindow(tz, at)) return at;
  const t = DateTime.fromJSDate(at).setZone(tz);
  const day = t.hour >= CALL_END_HOUR ? t.plus({ days: 1 }) : t;
  return day.set({ hour: CHECKIN_MORNING_HOUR, minute: 0, second: 0, millisecond: 0 }).toJSDate();
}

/** After a no-answer on attempt `attempt`: once more the next day at the same time (kept inside the window), then stop. */
export function checkinRetryAt(attempt: number, tz: string, at: Date = new Date()): Date | null {
  if (attempt >= CHECKIN_MAX_ATTEMPTS) return null;
  const t = DateTime.fromJSDate(at).setZone(tz).plus({ days: 1 });
  const hour = Math.min(Math.max(t.hour, CALL_START_HOUR), CALL_END_HOUR - 1);
  return t.set({ hour, minute: hour === t.hour ? t.minute : 0, second: 0, millisecond: 0 }).toJSDate();
}

/**
 * Whether the consent the customer agreed to covers an AI-voice call. Only the wording added with the voice
 * agent does ("…an artificial or AI-generated voice…"); a booking made before it doesn't count.
 */
export const coversAiCalls = (consentText: string | null | undefined) => /artificial or AI-generated voice/i.test(consentText ?? "");

export type CheckinPlan = { kind: "call"; at: Date } | { kind: "email_only"; reason: string };

/** Call (and when), or email only. Pure apart from its inputs. */
export function planCheckin(input: { callsOn: boolean; configured: boolean; consentText: string | null; phone: string | null; doNotCall: boolean; tz: string; doneAt?: Date }): CheckinPlan {
  if (!input.callsOn) return { kind: "email_only", reason: "check-in calls are off" };
  if (!input.configured) return { kind: "email_only", reason: "the check-in agent isn't set up" };
  if (!coversAiCalls(input.consentText)) return { kind: "email_only", reason: "their consent doesn't cover AI calls" };
  if (!input.phone || !usPhone(input.phone)) return { kind: "email_only", reason: "no usable US number" };
  if (input.doNotCall) return { kind: "email_only", reason: "on the do-not-call list" };
  return { kind: "call", at: checkinTime(input.tz, input.doneAt) };
}

/** "$100" from cents. */
export const dollars = (cents: number) => `$${(cents / 100).toFixed(cents % 100 ? 2 : 0)}`;

/** The check-in call's dynamic variables. Every one is always present (an empty string when unknown). */
export function checkinVariables(
  job: { id: string; name: string; email: string | null; address: string | null },
  account: { full_name: string; referral_reward_cents?: number | null; referral_goal?: number | null },
) {
  const first = firstNameOf(job.name);
  const reward = account.referral_reward_cents ?? 10000;
  return {
    job_id: job.id,
    first_name: first,
    greeting: first ? `Hi ${first}` : "Hi there",
    customer_name: job.name.trim(),
    customer_email: (job.email ?? "").trim(),
    company_name: account.full_name,
    address: (job.address ?? "").trim(),
    reward: reward > 0 ? `a ${dollars(reward)} gift card` : "",
    referral_goal: String(account.referral_goal ?? 5),
  };
}

// ---------- After the call ----------

export const CHECKIN_OUTCOMES = ["went_well", "issue", "callback", "no_answer", "do_not_call"] as const;
export type CheckinOutcome = (typeof CHECKIN_OUTCOMES)[number];

/** A 1–5 rating from whatever the agent collected ("4", 4, "4 out of 5", "five"), or null. */
export function ratingOf(v: unknown): number | null {
  const words: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5 };
  const s = String(v ?? "").trim().toLowerCase();
  const n = /^\d/.test(s) ? parseInt(s, 10) : words[s.split(/\s+/)[0] ?? ""];
  return Number.isInteger(n) && n >= 1 && n <= 5 ? n : null;
}

/**
 * What came of a check-in call, from what happened (the tools it called) and what the agent collected. A problem
 * the customer raised wins over everything but do-not-call, so a roofer is never told "went well" about one.
 */
export function checkinOutcome(input: {
  doNotCall: boolean;
  voicemail: boolean;
  userTurns: number;
  issueReported: boolean; // report_issue ran on the call
  referralSent: boolean; // send_referral ran on the call
  collected: unknown;
  rating: number | null;
}): CheckinOutcome {
  if (input.doNotCall || input.collected === "do_not_call") return "do_not_call";
  if (input.voicemail || input.userTurns === 0) return "no_answer";
  if (input.issueReported || input.collected === "issue" || (input.rating != null && input.rating <= 2)) return "issue";
  if (input.referralSent || input.collected === "went_well" || (input.rating != null && input.rating >= 4)) return "went_well";
  return "callback";
}

// ---------- The referral page ----------

export { REFERRAL_PERMISSION_TEXT } from "@/lib/booking/constants";

export type ReferralRow = { name: string; phone: string; email: string | null; address: string | null };
export type RowProblem = { index: number; error: string };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const s = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/**
 * The page's rows, checked: a name and a US phone are required, email and address optional. Empty rows are
 * dropped; a row repeating an earlier one's phone or email (in this submission) is refused. At most `max`.
 */
export function cleanReferralRows(input: unknown, max: number): { rows: ReferralRow[]; problems: RowProblem[] } {
  const list = Array.isArray(input) ? input.slice(0, 10) : [];
  const rows: ReferralRow[] = [];
  const problems: RowProblem[] = [];
  const seen = new Set<string>();
  list.forEach((raw, index) => {
    const r = (raw ?? {}) as Record<string, unknown>;
    const name = s(r.name, 100);
    const phoneRaw = s(r.phone, 40);
    const emailRaw = s(r.email, 200).toLowerCase();
    const address = s(r.address, 300);
    if (!name && !phoneRaw && !emailRaw && !address) return; // an empty row
    if (!name) return problems.push({ index, error: "Add their name." });
    const phone = usPhone(phoneRaw);
    if (!phone) return problems.push({ index, error: "Add a 10-digit US phone number." });
    if (emailRaw && !EMAIL.test(emailRaw)) return problems.push({ index, error: "That email doesn't look right." });
    const keys = [phone, emailRaw].filter(Boolean);
    if (keys.some((k) => seen.has(k))) return problems.push({ index, error: "This person is already listed above." });
    keys.forEach((k) => seen.add(k));
    rows.push({ name, phone, email: emailRaw || null, address: address || null });
  });
  if (rows.length > max) {
    rows.slice(max).forEach(() => problems.push({ index: max, error: `Up to ${max} people.` }));
    rows.length = max;
  }
  return { rows, problems };
}

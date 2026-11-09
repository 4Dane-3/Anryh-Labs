import { createHmac, timingSafeEqual } from "node:crypto";
import { DateTime } from "luxon";

// The speed-to-lead voice agent's rules, kept pure so tests can check the edges: when a lead may be called
// (8am–8pm in their time zone), when a no-answer is retried, what the agent is told about the lead, and
// ElevenLabs' webhook signature.

export const CALL_START_HOUR = 8; // 8:00am
export const CALL_END_HOUR = 20; // until 8:00pm

/** The time zone to call in: the lead's own (the browser's) when it's a real IANA zone, else the account's. */
export function leadTimezone(browserTz: unknown, accountTz: string) {
  if (typeof browserTz === "string" && browserTz.length <= 64 && DateTime.now().setZone(browserTz).isValid) return browserTz;
  return accountTz;
}

/** Whether `at` is inside 8am–8pm in `tz`. */
export function inCallWindow(tz: string, at: Date = new Date()) {
  const t = DateTime.fromJSDate(at).setZone(tz);
  return t.hour >= CALL_START_HOUR && t.hour < CALL_END_HOUR;
}

/** `at` if it's inside the window, else the next 8:00am in `tz`. */
export function nextCallTime(tz: string, at: Date = new Date()): Date {
  if (inCallWindow(tz, at)) return at;
  const t = DateTime.fromJSDate(at).setZone(tz);
  const day = t.hour >= CALL_END_HOUR ? t.plus({ days: 1 }) : t;
  return day.set({ hour: CALL_START_HOUR, minute: 0, second: 0, millisecond: 0 }).toJSDate();
}

/** "8am tomorrow" / "8am" / "8am Monday" for the thank-you state, in the lead's time zone. */
export function callTimeLabel(when: Date, tz: string, now: Date = new Date()) {
  const w = DateTime.fromJSDate(when).setZone(tz);
  const n = DateTime.fromJSDate(now).setZone(tz);
  const time = w.minute === 0 ? w.toFormat("ha").toLowerCase() : w.toFormat("h:mma").toLowerCase();
  if (w.hasSame(n, "day")) return `${time} today`;
  if (w.hasSame(n.plus({ days: 1 }), "day")) return `${time} tomorrow`;
  return `${time} ${w.toFormat("cccc")}`;
}

export const RETRY_AFTER_MS = 2 * 60_000;
export const MAX_ATTEMPTS = 3; // the first call, a retry 2 minutes later, and one the next day

/**
 * After a no-answer on attempt `attempt` (1-based), when to try again, or null to stop: 2 minutes later after
 * the first (moved to 8am if that's outside the window), the next day at the same time (kept inside the
 * window) after the second.
 */
export function retryAt(attempt: number, tz: string, at: Date = new Date()): Date | null {
  if (attempt >= MAX_ATTEMPTS) return null;
  if (attempt === 1) return nextCallTime(tz, new Date(at.getTime() + RETRY_AFTER_MS));
  const t = DateTime.fromJSDate(at).setZone(tz).plus({ days: 1 });
  const hour = Math.min(Math.max(t.hour, CALL_START_HOUR), CALL_END_HOUR - 1);
  return t.set({ hour, minute: hour === t.hour ? t.minute : 0, second: 0, millisecond: 0 }).toJSDate();
}

// ---------- What the agent is told ----------

export type LeadForCall = {
  id: string;
  name: string;
  city?: string | null;
  address?: string | null;
  roof_issue?: string | null;
  coverage?: string | null;
  source?: string | null;
};

export type AccountForCall = {
  full_name: string;
  vertical?: string | null;
  service_area?: string | null;
  service_radius_miles?: number | null;
  timezone: string;
};

export const firstNameOf = (name: string) => {
  const first = name.trim().split(/\s+/)[0] ?? "";
  return /instant form lead/i.test(name) || first.length < 2 ? "" : first.charAt(0).toUpperCase() + first.slice(1);
};

/**
 * The call's dynamic variables, passed inline with the call so ElevenLabs never has to fetch them. Every
 * variable the prompt uses is always present (an empty string when unknown), or the call would fail to start.
 */
export function dynamicVariables(lead: LeadForCall, account: AccountForCall, inspectionHours: string, leadTz: string) {
  const roof = account.vertical === "roofing";
  const first = firstNameOf(lead.name);
  return {
    lead_id: lead.id,
    first_name: first,
    greeting: first ? `Hi ${first}` : "Hi there", // the first message's opening, so an unknown name reads naturally
    company_name: account.full_name,
    city: (lead.city ?? "").trim(),
    address: (lead.address ?? "").trim(),
    roof_issue: (lead.roof_issue ?? "").trim(),
    interest: (lead.coverage ?? "").trim(),
    business: roof ? "roofing" : "life insurance",
    service_area: roof ? [account.service_area, account.service_radius_miles ? `within ${account.service_radius_miles} miles` : ""].filter(Boolean).join(", ") : "",
    inspection_hours: inspectionHours,
    lead_timezone: leadTz,
    lead_source: lead.source === "instant_form" ? "a Facebook form" : "the website",
  };
}

const DAY_NAMES = ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const hm = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  const d = DateTime.fromObject({ hour: h, minute: m || 0 });
  return (m ? d.toFormat("h:mma") : d.toFormat("ha")).toLowerCase();
};

/** "Monday to Friday 9am–5pm, Saturday 9am–12pm" from the account's weekly hours. */
export function hoursSummary(rules: { weekday: number; start_time: string; end_time: string }[]) {
  const byDay = new Map<number, string>();
  for (const r of [...rules].sort((a, b) => a.weekday - b.weekday || a.start_time.localeCompare(b.start_time))) {
    const span = `${hm(r.start_time)}–${hm(r.end_time)}`;
    byDay.set(r.weekday, byDay.has(r.weekday) ? `${byDay.get(r.weekday)} and ${span}` : span);
  }
  const parts: string[] = [];
  let run: number[] = [];
  const flush = () => {
    if (!run.length) return;
    const span = byDay.get(run[0])!;
    parts.push(run.length > 2 ? `${DAY_NAMES[run[0]]} to ${DAY_NAMES[run[run.length - 1]]} ${span}` : run.map((d) => `${DAY_NAMES[d]} ${span}`).join(", "));
    run = [];
  };
  for (let d = 1; d <= 7; d++) {
    if (!byDay.has(d)) { flush(); continue; }
    if (run.length && byDay.get(run[0]) !== byDay.get(d)) flush();
    run.push(d);
  }
  flush();
  return parts.join(", ");
}

// ---------- Post-call ----------

export const OUTCOMES = ["booked", "not_qualified", "callback", "no_answer", "do_not_call"] as const;
export type CallOutcome = (typeof OUTCOMES)[number];
export const isOutcome = (v: unknown): v is CallOutcome => (OUTCOMES as readonly string[]).includes(v as string);

/**
 * ElevenLabs signs webhooks with `ElevenLabs-Signature: t=<unix>,v0=<hex hmac-sha256 of "<t>.<body>">`.
 * Rejects bad signatures and anything older than 30 minutes (replays).
 */
export function validElevenLabsSignature(raw: string, header: string | null, secret: string | undefined, now: number = Date.now()) {
  if (!secret || !header) return false;
  const parts = Object.fromEntries(header.split(",").map((p) => p.trim().split("=", 2) as [string, string]));
  const t = Number(parts.t);
  if (!parts.t || !parts.v0 || !Number.isFinite(t)) return false;
  if (Math.abs(now / 1000 - t) > 30 * 60) return false;
  const expected = Buffer.from(createHmac("sha256", secret).update(`${parts.t}.${raw}`).digest("hex"));
  const given = Buffer.from(parts.v0);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/** Median of a list of numbers (null when empty). */
export function median(xs: number[]) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// ---------- Open times, read out on the call ----------

export type SpokenTime = { start: string; label: string };

/**
 * A few open times to offer, labelled in the lead's time zone ("Saturday, November 7 at 10am"). With `day`
 * (YYYY-MM-DD, their time zone) every open time that day, up to 8; otherwise the soonest 3 days with
 * openings, up to 2 times each (a morning and an afternoon when there are both).
 */
export function spokenTimes(open: string[], tz: string, day?: string | null): SpokenTime[] {
  const label = (iso: string) => {
    const t = DateTime.fromISO(iso).setZone(tz);
    return `${t.toFormat("cccc, LLLL d")} at ${(t.minute ? t.toFormat("h:mma") : t.toFormat("ha")).toLowerCase()}`;
  };
  const dayOf = (iso: string) => DateTime.fromISO(iso).setZone(tz).toISODate();
  if (day && /^\d{4}-\d{2}-\d{2}$/.test(day)) return open.filter((t) => dayOf(t) === day).slice(0, 8).map((t) => ({ start: t, label: label(t) }));
  const byDay = new Map<string, string[]>();
  for (const t of open) {
    const d = dayOf(t)!;
    if (!byDay.has(d) && byDay.size >= 3) break;
    byDay.set(d, [...(byDay.get(d) ?? []), t]);
  }
  const out: SpokenTime[] = [];
  for (const times of byDay.values()) {
    const am = times.find((t) => DateTime.fromISO(t).setZone(tz).hour < 12);
    const pm = times.find((t) => DateTime.fromISO(t).setZone(tz).hour >= 12);
    for (const t of am && pm ? [am, pm] : times.slice(0, 2)) out.push({ start: t, label: label(t) });
  }
  return out;
}

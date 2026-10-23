import { DateTime } from "luxon";

export type AvailabilityRule = {
  weekday: number; // ISO: 1 = Monday ... 7 = Sunday
  start_time: string; // "HH:MM" or "HH:MM:SS", wall-clock in the agent's timezone
  end_time: string;
};

export type BusyRange = { start: Date; end: Date };

export type SlotConfig = {
  timezone: string;
  slotMinutes: number;
  bufferMinutes: number;
  minNoticeHours: number;
  maxDaysAhead: number;
};

function parseTime(value: string) {
  const [hour, minute] = value.split(":").map(Number);
  return { hour, minute };
}

/**
 * Bookable slot start times (UTC ISO strings, ascending) for the next `maxDaysAhead` days.
 * Rules are interpreted as wall-clock hours in the agent's timezone, so DST is handled by luxon.
 */
export function generateSlots(
  rules: AvailabilityRule[],
  busy: BusyRange[],
  config: SlotConfig,
  now: Date = new Date(),
): string[] {
  const { timezone, slotMinutes, bufferMinutes, minNoticeHours, maxDaysAhead } =
    config;

  const earliest = DateTime.fromJSDate(now).plus({ hours: minNoticeHours });
  const today = DateTime.fromJSDate(now, { zone: timezone }).startOf("day");
  const bufferMs = bufferMinutes * 60_000;
  const slotMs = slotMinutes * 60_000;
  const starts = new Set<number>();

  for (let offset = 0; offset <= maxDaysAhead; offset++) {
    const day = today.plus({ days: offset });
    // Skip days that don't exist in the timezone (never happens for startOf("day") but guards invalid zones)
    if (!day.isValid) continue;

    for (const rule of rules) {
      if (rule.weekday !== day.weekday) continue;

      const open = day.set(parseTime(rule.start_time));
      const close = day.set(parseTime(rule.end_time));

      for (
        let slotStart = open;
        slotStart.toMillis() + slotMs <= close.toMillis();
        slotStart = slotStart.plus({ minutes: slotMinutes })
      ) {
        const startMs = slotStart.toMillis();
        const endMs = startMs + slotMs;

        if (slotStart < earliest) continue;

        const conflicts = busy.some(
          (b) =>
            startMs < b.end.getTime() + bufferMs &&
            endMs > b.start.getTime() - bufferMs,
        );
        if (!conflicts) starts.add(startMs);
      }
    }
  }

  return [...starts]
    .sort((a, b) => a - b)
    .map((ms) => new Date(ms).toISOString());
}

// Ghost bookings (an agent setting): hold back a share of open times in the next two weeks so the
// calendar looks like a busy agent's. A held time looks exactly like a taken one: it simply isn't
// offered. Nothing is invented beyond that (no names, no "booked" labels), nothing is stored, and the
// agent's own calendar and client list never show these. The choice is a stable hash of the agent and
// the time, so the same times stay held across page loads.
export const GHOST_DAYS = 14;
const GHOST_SHARE_SOON = 0.45; // the next 3 days look busiest
const GHOST_SHARE_LATER = 0.3;
const GHOST_MIN_LEFT = 2; // every day keeps at least this many times (when it had them)

function hash01(text: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) / 0xffffffff;
}

/** The open times to offer once ghost bookings hold some back. Pure; `slots` are UTC ISO strings. */
export function withGhostHolds(slots: string[], seed: string, timezone: string, now: Date = new Date()): string[] {
  const today = DateTime.fromJSDate(now, { zone: timezone }).startOf("day");
  const byDay = new Map<string, string[]>();
  for (const s of slots) {
    const day = DateTime.fromISO(s, { zone: timezone }).toISODate()!;
    byDay.set(day, [...(byDay.get(day) ?? []), s]);
  }
  const held = new Set<string>();
  for (const [day, times] of byDay) {
    const offset = Math.round(DateTime.fromISO(day, { zone: timezone }).diff(today, "days").days);
    if (offset >= GHOST_DAYS || times.length <= GHOST_MIN_LEFT) continue;
    const share = offset < 3 ? GHOST_SHARE_SOON : GHOST_SHARE_LATER;
    // Hold the times whose hash falls under the share, lowest first, while enough stay open
    const ranked = times.map((t) => ({ t, r: hash01(`${seed}|${t}`) })).filter((x) => x.r < share).sort((a, b) => a.r - b.r);
    let open = times.length;
    for (const { t } of ranked) {
      if (open <= GHOST_MIN_LEFT) break;
      held.add(t);
      open--;
    }
  }
  return slots.filter((s) => !held.has(s));
}

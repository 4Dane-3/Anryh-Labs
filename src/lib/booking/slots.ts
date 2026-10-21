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

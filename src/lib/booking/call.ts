import { DateTime } from "luxon";

// "Call now" on the booking page: the agent's number, and whether the button shows right now. Pure,
// so tests can check the number formats and the working-hours edges.

/** A US number in any common format → "+13125550100", or null when it isn't one. */
export function usPhone(input: string): string | null {
  const d = input.replace(/\D/g, "");
  const ten = d.length === 11 && d.startsWith("1") ? d.slice(1) : d;
  if (ten.length !== 10 || /^[01]/.test(ten)) return null; // area codes never start with 0 or 1
  return `+1${ten}`;
}

/** "+13125550100" → "(312) 555-0100". */
export const displayPhone = (e164: string) => {
  const d = e164.replace(/\D/g, "").slice(-10);
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
};

export type HoursRule = { weekday: number; start_time: string; end_time: string }; // ISO weekday, "HH:MM[:SS]"

/** Inside one of the agent's weekly working-hours windows right now, in their own timezone. */
export function withinHours(rules: HoursRule[], timezone: string, at: Date = new Date()) {
  const now = DateTime.fromJSDate(at).setZone(timezone);
  const minutes = now.hour * 60 + now.minute;
  const toMin = (t: string) => {
    const [h, m] = t.split(":").map(Number);
    return h * 60 + (m || 0);
  };
  return rules.some((r) => r.weekday === now.weekday && minutes >= toMin(r.start_time) && minutes < toMin(r.end_time));
}

/** Whether the booking page shows the call button now. */
export function callButtonShows(agent: { call_button?: boolean | null; call_phone?: string | null; call_hours_only?: boolean | null; timezone: string }, rules: HoursRule[], at?: Date) {
  if (!agent.call_button || !agent.call_phone) return false;
  return agent.call_hours_only === false || withinHours(rules, agent.timezone, at);
}

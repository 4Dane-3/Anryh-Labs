// The nightly summary's rules, as pure functions (no I/O) so tests can check them: when a summary is due,
// which phase the campaign is in, and how Migz's running thoughts carry from one night to the next.

export const NIGHTLY_HOUR = 21; // 9pm in the agent's own timezone
export const SUMMARY_EVERY_DAYS = 3; // each summary covers the days since the last one: the agent's one Slack update every 3 days
export const MAX_ACTIVE_THOUGHTS = 6;
const MAX_FINISHED_THOUGHTS = 3;

export type Phase = "collecting" | "revising" | "none";
export type ThoughtKind = "test" | "change" | "watch";
export type ThoughtStatus = "considering" | "testing" | "ready" | "done" | "dropped";

export type Thought = {
  id: string;
  text: string;
  kind: ThoughtKind;
  status: ThoughtStatus;
  note: string; // what tonight's numbers say about it
  since: string; // the night (YYYY-MM-DD) Migz first had this thought
  nights: number; // how many nights it has been carried
};

export type ModelThought = { id: string; text: string; kind: ThoughtKind; status: ThoughtStatus; note: string };

const ACTIVE: ThoughtStatus[] = ["considering", "testing", "ready"];
export const isActive = (t: Pick<Thought, "status">) => ACTIVE.includes(t.status);

/**
 * True once the agent's local clock reaches 9pm and the last summary is SUMMARY_EVERY_DAYS or more days
 * old (or there's none yet): a summary every third evening, the agent's one regular Slack update.
 */
export function nightlyDue(localHour: number, lastDate: string | null, today: string) {
  if (localHour < NIGHTLY_HOUR) return false;
  if (!lastDate) return true;
  return Math.round((Date.parse(today) - Date.parse(lastDate)) / 86_400_000) >= SUMMARY_EVERY_DAYS;
}

/**
 * The first REVISE_AFTER_DAYS of a batch are for collecting results only: Migz changes nothing and just
 * thinks. After that it revises. No batch means there's nothing to report on.
 */
export function phaseOf(revisionsFrom: string | null | undefined, today: string): Phase {
  if (!revisionsFrom) return "none";
  return today < revisionsFrom ? "collecting" : "revising";
}

/**
 * Tonight's thoughts from what the model returned and what Migz was already thinking:
 *  - a returned id that matches an earlier thought keeps its start date and counts another night;
 *  - an unknown or blank id is a new thought;
 *  - an earlier active thought the model didn't mention carries over unchanged (it isn't forgotten);
 *  - finished (done) and dropped thoughts are reported tonight and then leave the notebook;
 *  - at most six stay active (ready first, then testing, then considering).
 */
export function mergeThoughts(previous: Thought[], returned: ModelThought[], today: string): Thought[] {
  const prev = new Map(previous.map((t) => [t.id, t]));
  let nextNumber = previous.reduce((m, t) => Math.max(m, Number(t.id.replace(/\D/g, "")) || 0), 0) + 1;
  const seen = new Set<string>();
  const out: Thought[] = [];

  for (const r of returned) {
    const text = r.text?.trim();
    if (!text) continue;
    const before = prev.get(r.id);
    const id = before ? before.id : `t${nextNumber++}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      text: text.slice(0, 240),
      kind: r.kind,
      status: r.status,
      note: (r.note ?? "").trim().slice(0, 300),
      since: before?.since ?? today,
      nights: before ? before.nights + 1 : 1,
    });
  }
  for (const t of previous) {
    if (seen.has(t.id) || !isActive(t)) continue;
    out.push({ ...t, nights: t.nights + 1, note: t.note });
  }

  const rank: Record<ThoughtStatus, number> = { ready: 0, testing: 1, considering: 2, done: 3, dropped: 4 };
  out.sort((a, b) => rank[a.status] - rank[b.status] || b.nights - a.nights);
  const active = out.filter(isActive).slice(0, MAX_ACTIVE_THOUGHTS);
  const finished = out.filter((t) => !isActive(t)).slice(0, MAX_FINISHED_THOUGHTS);
  return [...active, ...finished];
}

/** What carries into tomorrow night: only the thoughts still being worked on. */
export const carryOver = (thoughts: Thought[]) => thoughts.filter(isActive);

export type Narrative = {
  headline: string;
  happened: string[];
  budget_read: string;
  next: string[];
  page_note: string;
  fallback?: boolean;
};

export type NightlyNumbers = {
  spendCents: number;
  budgetCents: number; // the live daily budgets added up, for each day the summary covers
  yesterdaySpendCents: number | null; // the summary before this one's spend (a day's, before summaries went every other day)
  days?: number; // days the summary covers (1 for summaries written before they went every other day)
  impressions: number;
  reach: number;
  linkClicks: number;
  ctr: number | null;
  bookedCalls: number;
  batch: { spentCents: number; budgetCents: number; day: number; days: number } | null;
};

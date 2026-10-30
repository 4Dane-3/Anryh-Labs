// What happened after each lead. A booked call: showed up, no show, quoted, sold. A form lead or quote
// request: reached, not reached, booked, sold. The agent answers with one tap; Migz scores ads on it and
// Meta hears about the good ones. Pure (client-safe): the dashboard, the Slack ask, the review and the
// tests all use these words and rules.

export type CallOutcome = "showed_up" | "no_show" | "quoted" | "sold";
export type LeadOutcome = "reached" | "not_reached" | "booked" | "sold";
export type OutcomeKind = "call" | "lead";

export const CALL_OUTCOMES: { key: CallOutcome; label: string }[] = [
  { key: "showed_up", label: "Showed up" },
  { key: "no_show", label: "No show" },
  { key: "quoted", label: "Quoted" },
  { key: "sold", label: "Sold" },
];

export const LEAD_OUTCOMES: { key: LeadOutcome; label: string }[] = [
  { key: "reached", label: "Reached" },
  { key: "not_reached", label: "Couldn't reach" },
  { key: "booked", label: "Booked" },
  { key: "sold", label: "Sold" },
];

export const isCallOutcome = (v: unknown): v is CallOutcome => CALL_OUTCOMES.some((o) => o.key === v);
export const isLeadOutcome = (v: unknown): v is LeadOutcome => LEAD_OUTCOMES.some((o) => o.key === v);
export const outcomeLabel = (kind: OutcomeKind, o: string) => (kind === "call" ? CALL_OUTCOMES : LEAD_OUTCOMES).find((x) => x.key === o)?.label ?? o;

/** Quoted and sold calls showed up too. */
export const showedUp = (o: string | null | undefined) => o === "showed_up" || o === "quoted" || o === "sold";
/** Booked and sold leads were reached too. */
export const reached = (o: string | null | undefined) => o === "reached" || o === "booked" || o === "sold";

/**
 * The follow-up events Meta gets for an outcome, in order, so a sale also counts as a show. Bookings send
 * them as website events matched on the same hashed contact details as the booking; form leads as CRM
 * events on the lead id. A no-show or an unreached lead sends nothing.
 */
export function metaEventsFor(kind: OutcomeKind, o: string): ("ShowedUp" | "Contact" | "Purchase")[] {
  if (kind === "call") return o === "sold" ? ["ShowedUp", "Purchase"] : showedUp(o) ? ["ShowedUp"] : [];
  return o === "sold" ? ["Contact", "Purchase"] : reached(o) ? ["Contact"] : [];
}

/** The events still to send, given what was already sent (outcome_sent): each is sent once, ever. */
export function unsentEvents(kind: OutcomeKind, o: string, alreadySent: string | null | undefined) {
  const sent = new Set((alreadySent ?? "").split(",").filter(Boolean));
  return metaEventsFor(kind, o).filter((e) => !sent.has(e));
}

// ---------- Scoring ----------

/** Answered outcomes an ad (or account) needs before it's ranked on them instead of on bookings. */
export const MIN_OUTCOMES = 5;

/** The agent's answers about a set of leads, and what they say. Rates are null until MIN_OUTCOMES are answered. */
export function outcomeStats(outcomes: (string | null | undefined)[], kind: OutcomeKind = "call") {
  const answered = outcomes.filter((o) => !!o) as string[];
  const good = answered.filter((o) => (kind === "call" ? showedUp(o) : reached(o))).length;
  const sold = answered.filter((o) => o === "sold").length;
  const enough = answered.length >= MIN_OUTCOMES;
  return {
    total: outcomes.length,
    answered: answered.length,
    /** Calls that showed up (or leads reached). */
    good,
    sold,
    goodRate: enough ? good / answered.length : null,
    saleRate: enough ? sold / answered.length : null,
  };
}

/**
 * The cost an ad is ranked on: per sale once it has sales on enough answers, then per showed-up call, then
 * per booked call. Showed-up and sold counts are projected from the answered share onto every booking, so
 * unanswered calls don't make an ad look worse.
 */
export function rankingCost(spendCents: number, bookings: number, outcomes: (string | null | undefined)[]) {
  const s = outcomeStats(outcomes);
  if (s.goodRate !== null && s.saleRate !== null && s.sold >= 2) return { basis: "sale" as const, cents: Math.round(spendCents / (bookings * s.saleRate)) };
  if (s.goodRate !== null && s.good > 0) return { basis: "showed_up_call" as const, cents: Math.round(spendCents / (bookings * s.goodRate)) };
  return { basis: "booked_call" as const, cents: bookings ? Math.round(spendCents / bookings) : null };
}

/** "70% of its bookings showed up (7 of 10 answered)". */
export function showUpLine(outcomes: (string | null | undefined)[]) {
  const s = outcomeStats(outcomes);
  if (s.goodRate === null) return null;
  return `${Math.round(s.goodRate * 100)}% of its bookings showed up (${s.good} of ${s.answered} answered)${s.sold ? `, ${s.sold} sold` : ""}`;
}

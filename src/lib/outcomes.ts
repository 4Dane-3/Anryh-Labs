// What happened after each lead. A booked call: showed up, no show, quoted, sold, not interested. A form lead
// or quote request: reached, not reached, booked, sold, not interested. The agent answers with one tap; Migz
// scores ads on it and Meta hears about it. Pure (client-safe): the dashboard, the Slack ask, the review and
// the tests all use these words and rules.

export type CallOutcome = "showed_up" | "no_show" | "quoted" | "sold" | "not_interested";
export type LeadOutcome = "reached" | "not_reached" | "booked" | "sold" | "not_interested";
export type OutcomeKind = "call" | "lead";
export type MetaOutcomeEvent = "ShowedUp" | "Contact" | "Purchase" | "NotInterested";

export const CALL_OUTCOMES: { key: CallOutcome; label: string }[] = [
  { key: "showed_up", label: "Showed up" },
  { key: "no_show", label: "No show" },
  { key: "quoted", label: "Quoted" },
  { key: "sold", label: "Sold" },
  { key: "not_interested", label: "Not interested" },
];

export const LEAD_OUTCOMES: { key: LeadOutcome; label: string }[] = [
  { key: "reached", label: "Reached" },
  { key: "not_reached", label: "Couldn't reach" },
  { key: "booked", label: "Booked" },
  { key: "sold", label: "Sold" },
  { key: "not_interested", label: "Not interested" },
];

/**
 * Answers that start the agent's "after a missed call" automated emails, like tapping Tried to call: a form lead
 * or quote request they couldn't reach. (Tried to call and Sent an email start them too.)
 */
export const startsFollowUps = (kind: OutcomeKind, outcome: string) => kind === "lead" && outcome === "not_reached";

/** Answers that mean it went nowhere (shown in red). */
export const badOutcome = (o: string | null | undefined) => o === "no_show" || o === "not_reached" || o === "not_interested";

// ---------- Client status ----------

/** Where someone stands with the agent: every lead starts as a prospect; "current" has a plan with them. */
export type ClientStatus = "prospect" | "current" | "not_interested";
export const CLIENT_STATUSES: { key: ClientStatus; label: string }[] = [
  { key: "prospect", label: "Prospect" },
  { key: "current", label: "Current plan" },
  { key: "not_interested", label: "Not interested" },
];
export const isClientStatus = (v: unknown): v is ClientStatus => CLIENT_STATUSES.some((s) => s.key === v);

/** The status an outcome moves a client to: a sale makes them current, a no makes them not interested. */
export const statusForOutcome = (o: string): ClientStatus | null => (o === "sold" ? "current" : o === "not_interested" ? "not_interested" : null);

export const isCallOutcome = (v: unknown): v is CallOutcome => CALL_OUTCOMES.some((o) => o.key === v);
export const isLeadOutcome = (v: unknown): v is LeadOutcome => LEAD_OUTCOMES.some((o) => o.key === v);
export const outcomeLabel = (kind: OutcomeKind, o: string) => (kind === "call" ? CALL_OUTCOMES : LEAD_OUTCOMES).find((x) => x.key === o)?.label ?? o;

/** Quoted and sold calls showed up too, and so did one who said no on the call. */
export const showedUp = (o: string | null | undefined) => o === "showed_up" || o === "quoted" || o === "sold" || o === "not_interested";
/** Booked and sold leads were reached too, and so was one who said no. */
export const reached = (o: string | null | undefined) => o === "reached" || o === "booked" || o === "sold" || o === "not_interested";

/**
 * The follow-up events Meta gets for an outcome, in order, so a sale also counts as a show. Bookings send
 * them as website events matched on the same hashed contact details as the booking; form leads as CRM
 * events on the lead id. "Not interested" means the agent talked to them and they said no, so it counts as
 * a show (or a contact) followed by NotInterested, which fills in Meta's lead quality reports. A no-show or
 * an unreached lead sends nothing.
 */
export function metaEventsFor(kind: OutcomeKind, o: string): MetaOutcomeEvent[] {
  const first = kind === "call" ? "ShowedUp" : "Contact";
  if (o === "sold") return [first, "Purchase"];
  if (o === "not_interested") return [first, "NotInterested"];
  return (kind === "call" ? showedUp(o) : reached(o)) ? [first] : [];
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
  const notInterested = answered.filter((o) => o === "not_interested").length;
  const enough = answered.length >= MIN_OUTCOMES;
  return {
    total: outcomes.length,
    answered: answered.length,
    /** Calls that showed up (or leads reached). */
    good,
    sold,
    notInterested,
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

/**
 * The cost an instant-form ad is ranked on, like rankingCost for bookings: per sale once it has sales on
 * enough answers, then per interested lead (reached and didn't say no), then per form lead. Projected from
 * the answered share onto every lead, so leads the agent hasn't marked don't make an ad look worse.
 */
export function leadRankingCost(spendCents: number, leads: number, outcomes: (string | null | undefined)[]) {
  const s = outcomeStats(outcomes, "lead");
  if (s.saleRate !== null && s.sold >= 2) return { basis: "sale" as const, cents: Math.round(spendCents / (leads * s.saleRate)) };
  const interested = s.good - s.notInterested;
  if (s.goodRate !== null && interested > 0) return { basis: "interested_lead" as const, cents: Math.round(spendCents / ((leads * interested) / s.answered)) };
  return { basis: "form_lead" as const, cents: leads ? Math.round(spendCents / leads) : null };
}

/** "60% of its form leads were reached (6 of 10 answered), 2 sold, 3 not interested". */
export function reachLine(outcomes: (string | null | undefined)[]) {
  const s = outcomeStats(outcomes, "lead");
  if (s.goodRate === null) return null;
  const extra = [s.sold && `${s.sold} sold`, s.notInterested && `${s.notInterested} not interested`].filter(Boolean).join(", ");
  return `${Math.round(s.goodRate * 100)}% of its form leads were reached (${s.good} of ${s.answered} answered)${extra ? `, ${extra}` : ""}`;
}

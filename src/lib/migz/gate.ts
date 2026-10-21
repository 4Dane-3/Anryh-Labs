// The quiet-run gate: plain code that decides whether anything changed enough to be worth a model's
// time. Most 6-hourly checks on a small account find nothing new; those skip every model and log
// "skipped: quiet".

import type { Snapshot } from "@/lib/migz/snapshot";

export type GateState = {
  impressions14: number;
  bookings14: number;
  spendCents14: number;
  statuses: string; // ad set + ad statuses, sorted
  library: string; // creative ids waiting to launch
  generating: number;
  focus?: string; // the agent's ad focus, in order
};

export const MATERIAL_IMPRESSIONS = 1000;
export const MAX_QUIET_HOURS = 24; // a pro looks at the account at least daily

export function gateState(snapshot: Snapshot): GateState {
  let impressions = 0;
  let bookings = 0;
  let spend = 0;
  for (const m of snapshot.adMetrics.values()) {
    impressions += m.t.d14.impressions;
    bookings += m.t.d14.booked_calls;
    spend += m.t.d14.spend_cents;
  }
  return {
    impressions14: impressions,
    bookings14: bookings,
    spendCents14: spend,
    statuses: snapshot.guardAdsets
      .flatMap((s) => [`${s.meta_adset_id}:${s.status}:${s.daily_budget_cents}`, ...s.ads.map((a) => `${a.meta_ad_id}:${a.status}`)])
      .sort()
      .join(","),
    library: snapshot.forModel.creatives_not_running.map((c) => c.creative_id).sort().join(","),
    generating: snapshot.openGenerations,
    focus: snapshot.focus.join(","),
  };
}

export type GateInput = {
  trigger: "schedule" | "manual";
  snapshot: Snapshot;
  previous: GateState | null;
  lastOperatorAt: string | null;
  auditMaterial: boolean;
  experimentsReady: number;
  routinesDue: string[];
  now?: Date;
};

/** Returns the reasons to run the operator; an empty list means quiet. */
export function materialChanges(input: GateInput): string[] {
  const reasons: string[] = [];
  const now = input.now ?? new Date();
  const cur = gateState(input.snapshot);
  const prev = input.previous;
  if (input.trigger === "manual") reasons.push("review requested");
  const liveAds = input.snapshot.guardAdsets.flatMap((s) => s.ads).filter((a) => a.status === "ACTIVE").length;
  if (!liveAds) reasons.push("no live ads");
  if (!prev || !input.lastOperatorAt) reasons.push("first full review");
  else {
    if (cur.bookings14 > prev.bookings14) reasons.push(`${cur.bookings14 - prev.bookings14} new booked call(s)`);
    if (cur.impressions14 - prev.impressions14 >= MATERIAL_IMPRESSIONS)
      reasons.push(`${(cur.impressions14 - prev.impressions14).toLocaleString("en-US")} new impressions`);
    if (cur.statuses !== prev.statuses) reasons.push("ad or ad set status changed");
    if (cur.library !== prev.library && cur.library) reasons.push("new creative ready to launch");
    if (cur.generating < prev.generating) reasons.push("a creative finished generating");
    if ((prev.focus ?? "") !== (cur.focus ?? "")) reasons.push("the agent changed their ad focus");
    const hours = (now.getTime() - new Date(input.lastOperatorAt).getTime()) / 3_600_000;
    if (hours >= MAX_QUIET_HOURS) reasons.push(`daily check (${Math.floor(hours)}h since last full review)`);
  }
  if (input.auditMaterial) reasons.push("new audit finding");
  if (input.experimentsReady) reasons.push(`${input.experimentsReady} experiment(s) ready for a verdict`);
  for (const r of input.routinesDue) reasons.push(`${r} routine due`);
  return [...new Set(reasons)];
}

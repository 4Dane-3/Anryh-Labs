// Facebook vs Instagram: what each platform spends and books, and when Migz may focus an ad set on one.
// Pure (no I/O) so the snapshot, the guardrail and the tests share it.
//
// Booked calls per platform come from our own bookings: every ad link carries Meta's {{placement}}
// macro as utm_term (e.g. "Instagram_Reels", "Facebook_Mobile_Feed"), saved with the booking.

export type Platform = "facebook" | "instagram";
export const PLATFORMS: Platform[] = ["facebook", "instagram"];

export type PlatformTotals = { spendCents: number; impressions: number; linkClicks: number; bookedCalls: number };
export type PlatformStats = Record<Platform, PlatformTotals>;

export const emptyPlatformStats = (): PlatformStats => ({
  facebook: { spendCents: 0, impressions: 0, linkClicks: 0, bookedCalls: 0 },
  instagram: { spendCents: 0, impressions: 0, linkClicks: 0, bookedCalls: 0 },
});

/** The platform behind a placement value: Meta's macro ("Instagram_Reels") or its insights breakdown ("instagram"). */
export function platformOf(raw: string | null | undefined): Platform | null {
  const v = (raw ?? "").toLowerCase();
  if (v.startsWith("instagram") || v === "ig") return "instagram";
  if (v.startsWith("facebook") || v === "fb") return "facebook";
  return null; // Messenger, Audience Network, unknown
}

// Focusing an ad set on one platform restarts Meta's learning, so it needs clear evidence:
export const FOCUS_MIN_CALLS = 5; // booked calls on the platform being kept
export const FOCUS_MIN_SPEND_CENTS = 4000; // $40 on each platform
export const FOCUS_MIN_ADVANTAGE = 0.25; // the kept platform books calls at least 25% cheaper

const costPerCall = (t: PlatformTotals) => t.spendCents / Math.max(1, t.bookedCalls); // 0 calls counts as 1: conservative

/** Which platform clearly books cheaper, if either (same test the guardrail applies). */
export function strongerPlatform(stats: PlatformStats): Platform | null {
  for (const keep of PLATFORMS) {
    const drop = keep === "facebook" ? "instagram" : "facebook";
    if (focusAllowed(stats, keep, drop) === null) return keep;
  }
  return null;
}

/** Null when the numbers justify keeping only `keep`; otherwise why not, with the numbers. */
export function focusAllowed(stats: PlatformStats, keep: Platform, drop: Platform): string | null {
  const k = stats[keep];
  const d = stats[drop];
  const usd = (c: number) => `$${(c / 100).toFixed(2)}`;
  if (k.bookedCalls < FOCUS_MIN_CALLS)
    return `${keep} has ${k.bookedCalls} booked call${k.bookedCalls === 1 ? "" : "s"} in the last 14 days; focusing on it needs at least ${FOCUS_MIN_CALLS}.`;
  if (k.spendCents < FOCUS_MIN_SPEND_CENTS || d.spendCents < FOCUS_MIN_SPEND_CENTS)
    return `Each platform needs at least ${usd(FOCUS_MIN_SPEND_CENTS)} of spend to compare (${keep} ${usd(k.spendCents)}, ${drop} ${usd(d.spendCents)}).`;
  const kept = costPerCall(k);
  const dropped = costPerCall(d);
  if (kept > dropped * (1 - FOCUS_MIN_ADVANTAGE))
    return `${keep} books calls at ${usd(kept)} each vs ${usd(dropped)} on ${drop}; focusing needs it at least ${FOCUS_MIN_ADVANTAGE * 100}% cheaper.`;
  return null;
}

/**
 * The guardrail for set_placements: back to automatic is always allowed, and so is narrowing positions
 * while keeping both platforms (judged on the placement metrics). Dropping a whole platform needs the
 * booked-call evidence above.
 */
export function checkPlatformFocus(stats: PlatformStats | undefined, placements: string[]): string | null {
  if (!placements.length) return null;
  const kept = new Set(placements.map(platformOf).filter((p): p is Platform => !!p));
  if (kept.size !== 1) return null;
  const keep = [...kept][0];
  const drop: Platform = keep === "facebook" ? "instagram" : "facebook";
  const why = focusAllowed(stats ?? emptyPlatformStats(), keep, drop);
  return why ? `Not enough evidence to drop ${drop}: ${why} Keep automatic placements (Meta already shifts spend toward what books) or narrow positions within both platforms.` : null;
}

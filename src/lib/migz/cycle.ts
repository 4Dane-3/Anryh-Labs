// The creative cycle: a campaign launches its full creative mix and learns for a week, then every two weeks
// Migz pauses the clear losers and adds one wave of 2–3 new creatives, and reads the wave for a week before
// judging it. A campaign that keeps going (Keep going renews it) keeps the same rhythm across renewals.
// Meta publishes no cadence; this follows agency and practitioner advice: launch wide, leave it alone while it
// learns, refresh in batches rather than one ad at a time. Pure, so the schedule is unit-tested.

/** Days 1–7 only learn: nothing is paused or added. */
export const LEARN_DAYS = 7;
export const FIRST_WAVE_DAY = 8;
export const WAVE_EVERY_DAYS = 14;
/** Runs shorter than this get no wave: they keep the creative they launched with. */
export const MIN_CYCLE_DAYS = 14;
/** A wave held back (a budget change that day, no review ran) can still go out this many days after its day. */
export const WAVE_LATE_DAYS = 2;
/** New creatives per ad set in a wave. */
export const WAVE_MIN = 2;
export const WAVE_MAX = 3;
/** Live ads per ad set the wave aims for, after the losers are paused. */
export const LIVE_ADS_LOW = 8;
export const LIVE_ADS_HIGH = 12;
/** A clear loser spent this many times the ad set's target cost per result with no result at all. */
export const LOSER_SPEND_MULTIPLE = 2.5;
/**
 * A costly loser (this many times the target, no result) is losing real money: it may be paused on any day. The
 * same as the clear-loser line, so a clear loser never waits for the first week or a wave's read to end.
 */
export const COSTLY_LOSER_MULTIPLE = LOSER_SPEND_MULTIPLE;
/** After a wave, its new ads get this many days of reading before anything is paused again. */
export const READ_DAYS = 7;

/** Day number of a date in the run, 1 on the day it started (ISO dates in the agent's timezone). */
export function cycleDay(startedOn: string, today: string) {
  const ms = Date.parse(`${today}T00:00:00Z`) - Date.parse(`${startedOn}T00:00:00Z`);
  return Math.floor(ms / 86_400_000) + 1;
}

/** The wave day at or before `day` (8, 22, 36, ...), or null in the first week. */
export function lastWaveDay(day: number) {
  if (day < FIRST_WAVE_DAY) return null;
  return FIRST_WAVE_DAY + Math.floor((day - FIRST_WAVE_DAY) / WAVE_EVERY_DAYS) * WAVE_EVERY_DAYS;
}

export const isWaveDay = (day: number) => lastWaveDay(day) === day;
export const nextWaveDay = (day: number) => (day < FIRST_WAVE_DAY ? FIRST_WAVE_DAY : lastWaveDay(day)! + WAVE_EVERY_DAYS);

/** Whether a run gets waves at all: 14 days or more, or set to keep going. */
export const runsTheCycle = (runDays: number, renews: boolean) => renews || runDays >= MIN_CYCLE_DAYS;

export type WaveStatus =
  | { due: true; day: number; waveDay: number }
  | { due: false; day: number; waveDay: number | null; nextWaveDay: number | null; why: "short" | "learning" | "reading" | "done" | "changing" };

/**
 * Whether this review adds the creative wave. `changingToday`: a budget, targeting or optimization change
 * happened today (the wave waits for a quiet day). `madeSince`: wave creatives already made or proposed since
 * the current wave day (one wave per two weeks, whatever the agent decided about it).
 */
export function waveStatus(input: { day: number; runDays: number; renews: boolean; changingToday: boolean; madeSince: number }): WaveStatus {
  const { day } = input;
  if (!runsTheCycle(input.runDays, input.renews)) return { due: false, day, waveDay: null, nextWaveDay: null, why: "short" };
  const waveDay = lastWaveDay(day);
  if (waveDay === null) return { due: false, day, waveDay: null, nextWaveDay: FIRST_WAVE_DAY, why: "learning" };
  const next = waveDay + WAVE_EVERY_DAYS;
  if (input.madeSince > 0) return { due: false, day, waveDay, nextWaveDay: next, why: "done" };
  if (day - waveDay > WAVE_LATE_DAYS) return { due: false, day, waveDay, nextWaveDay: next, why: "reading" };
  if (input.changingToday) return { due: false, day, waveDay, nextWaveDay: day - waveDay < WAVE_LATE_DAYS ? day + 1 : next, why: "changing" };
  return { due: true, day, waveDay };
}

/**
 * Whether clear losers may be paused today: from day 8, except in the week after a wave, which reads its new
 * ads (the wave day itself and the days a held-back wave may still go out stay open, so losers go first).
 * Shorter runs pause from day 8 on. A costly loser (isCostlyLoser) may be paused any day. Null when allowed.
 */
export function pauseWindow(day: number, cycling: boolean) {
  if (day <= LEARN_DAYS) return `The campaign is in its first ${LEARN_DAYS} days, which only learn. Clear losers are paused from day ${FIRST_WAVE_DAY}; only a costly loser (${COSTLY_LOSER_MULTIPLE}× the target with no result) can go sooner.`;
  if (!cycling) return null;
  const waveDay = lastWaveDay(day)!;
  const since = day - waveDay;
  if (since <= WAVE_LATE_DAYS || since >= READ_DAYS) return null;
  return `The day-${waveDay} wave's new ads are being read until day ${waveDay + READ_DAYS}. Clear losers are paused from then; only a costly loser (${COSTLY_LOSER_MULTIPLE}× the target with no result) can go sooner.`;
}

/** Spent COSTLY_LOSER_MULTIPLE times the target with no result: paused on any day, whatever the cycle says. */
export function isCostlyLoser(ad: { spend_cents: number; results: number }, targetCents: number | null | undefined) {
  return !!targetCents && ad.results === 0 && ad.spend_cents >= targetCents * COSTLY_LOSER_MULTIPLE;
}

/**
 * The clear-loser rule: an ad may be paused only once it has spent LOSER_SPEND_MULTIPLE times the ad set's target
 * cost per result (booked call, or form lead on an instant-form ad set) with no result. Weak click-through or
 * cost per landing page view are hints for what to build next, not reasons to pause. Null when it's a clear loser.
 */
export function loserCheck(ad: { spend_cents: number; results: number }, targetCents: number | null | undefined) {
  if (!targetCents) return null; // no target known: the other checks decide
  const need = Math.round(targetCents * LOSER_SPEND_MULTIPLE);
  if (ad.results > 0) return `It has ${ad.results} result${ad.results === 1 ? "" : "s"} in the last 14 days, so it isn't a clear loser. Only ads with no result after $${(need / 100).toFixed(0)} of spend (${LOSER_SPEND_MULTIPLE}× the $${(targetCents / 100).toFixed(0)} target) are paused.`;
  if (ad.spend_cents < need) return `It has spent $${(ad.spend_cents / 100).toFixed(2)} of the $${(need / 100).toFixed(0)} (${LOSER_SPEND_MULTIPLE}× the $${(targetCents / 100).toFixed(0)} target per result) it needs before it counts as a clear loser. Weak early numbers are a note for the next wave, not a reason to pause.`;
  return null;
}

/** How many wave creatives an ad set can take: up to LIVE_ADS_HIGH live ads. */
export const waveRoom = (liveAds: number) => Math.max(0, LIVE_ADS_HIGH - liveAds);

/** The cycle in plain words, for the plan screens and the Brain page. */
export function cycleSteps(runDays: number, renews: boolean): { when: string; what: string }[] {
  const learn = { when: "Days 1–7", what: `Every ad launches on day one, each on a different angle. Meta learns who books, and Migz changes nothing, except pausing an ad that spends ${COSTLY_LOSER_MULTIPLE}× the target with nothing to show.` };
  if (!runsTheCycle(runDays, renews))
    return [learn, { when: `Days 8–${runDays}`, what: "Migz pauses only clear losers (ads that spent well past the target with no result) and keeps the rest running. No new ads: the campaign is too short to read them." }];
  const later = renews || runDays > FIRST_WAVE_DAY + WAVE_EVERY_DAYS - 1;
  return [
    learn,
    { when: `Day ${FIRST_WAVE_DAY}`, what: `Migz pauses the clear losers and adds ${WAVE_MIN}–${WAVE_MAX} new ads to each ad set together, built from what's winning plus one new angle to test.` },
    { when: `Days ${FIRST_WAVE_DAY + 1}–${FIRST_WAVE_DAY + READ_DAYS - 1}`, what: "Migz reads the new ads and changes nothing, so each one gets a fair week." },
    ...(runDays >= FIRST_WAVE_DAY + READ_DAYS || renews
      ? [{ when: `Days ${FIRST_WAVE_DAY + READ_DAYS}–${later ? FIRST_WAVE_DAY + WAVE_EVERY_DAYS - 1 : runDays}`, what: "Migz pauses the clear losers, new or old, and keeps the rest running." }]
      : []),
    ...(later
      ? [{ when: `Day ${FIRST_WAVE_DAY + WAVE_EVERY_DAYS}, then every 2 weeks`, what: `The same again${renews ? ", for as long as the campaign keeps going" : ""}: pause the clear losers, add one wave, read it.` }]
      : []),
  ];
}


// Pure metric math on per-ad daily rows. No I/O, so it is shared by the snapshot, the auditor,
// routines, the experiment judge and the Brain page, and easy to test.

export type DailyRow = {
  meta_ad_id: string;
  date: string;
  spend_cents: number;
  impressions: number;
  clicks: number;
  reach?: number;
  frequency?: number;
  link_clicks?: number;
  video_plays?: number;
  video_3s_views?: number;
  thruplays?: number;
  video_p25?: number;
  video_p50?: number;
  video_p75?: number;
  video_p100?: number;
  avg_watch_ms?: number;
  landing_page_views?: number;
};

export type Totals = {
  spend_cents: number;
  impressions: number;
  clicks: number;
  link_clicks: number;
  reach: number;
  video_plays: number;
  video_3s_views: number;
  thruplays: number;
  p25: number;
  p50: number;
  p75: number;
  p100: number;
  watch_ms_weighted: number; // avg_watch_ms * plays, to average across days
  booked_calls: number;
  visits: number;
  days: number;
  frequency_max: number;
};

export const emptyTotals = (): Totals => ({
  spend_cents: 0,
  impressions: 0,
  clicks: 0,
  link_clicks: 0,
  reach: 0,
  video_plays: 0,
  video_3s_views: 0,
  thruplays: 0,
  p25: 0,
  p50: 0,
  p75: 0,
  p100: 0,
  watch_ms_weighted: 0,
  booked_calls: 0,
  visits: 0,
  days: 0,
  frequency_max: 0,
});

export function addRow(t: Totals, r: DailyRow) {
  t.spend_cents += r.spend_cents;
  t.impressions += r.impressions;
  t.clicks += r.clicks;
  t.link_clicks += r.link_clicks ?? 0;
  t.reach += r.reach ?? 0; // daily reach summed: an upper bound, used only for frequency fallback
  t.video_plays += r.video_plays ?? 0;
  t.video_3s_views += r.video_3s_views ?? 0;
  t.thruplays += r.thruplays ?? 0;
  t.p25 += r.video_p25 ?? 0;
  t.p50 += r.video_p50 ?? 0;
  t.p75 += r.video_p75 ?? 0;
  t.p100 += r.video_p100 ?? 0;
  t.watch_ms_weighted += (r.avg_watch_ms ?? 0) * (r.video_plays ?? 0);
  t.days += 1;
  t.frequency_max = Math.max(t.frequency_max, r.frequency ?? 0);
  return t;
}

const ratio = (a: number, b: number) => (b > 0 ? a / b : null);

/** Derived rates for one window. Nulls mean "not enough to say" (no impressions, not a video, ...). */
export function derive(t: Totals) {
  const isVideo = t.video_plays > 0 || t.video_3s_views > 0;
  return {
    spend_usd: t.spend_cents / 100,
    impressions: t.impressions,
    ctr: ratio(t.clicks, t.impressions),
    link_ctr: ratio(t.link_clicks, t.impressions),
    cpm_usd: t.impressions ? (t.spend_cents / 100 / t.impressions) * 1000 : null,
    // Average daily frequency (impressions / reach per day) is the closest honest number we have
    // without a separate unique-reach query for the whole window.
    frequency: ratio(t.impressions, t.reach),
    hook_rate: isVideo ? ratio(t.video_3s_views, t.impressions) : null,
    hold_rate: isVideo ? ratio(t.thruplays, t.video_3s_views) : null,
    cost_per_thruplay_usd: t.thruplays ? t.spend_cents / 100 / t.thruplays : null,
    avg_watch_s: t.video_plays ? t.watch_ms_weighted / t.video_plays / 1000 : null,
    retention: isVideo && t.impressions
      ? {
          // share of 3-second viewers still watching at each quartile
          p25: ratio(t.p25, t.video_3s_views),
          p50: ratio(t.p50, t.video_3s_views),
          p75: ratio(t.p75, t.video_3s_views),
          p100: ratio(t.p100, t.video_3s_views),
        }
      : null,
    booked_calls: t.booked_calls,
    cost_per_booked_call_usd: t.booked_calls ? t.spend_cents / 100 / t.booked_calls : null,
    visits: t.visits,
    visit_to_booking: ratio(t.booked_calls, t.visits),
  };
}

export type Derived = ReturnType<typeof derive>;

/**
 * Fatigue: rising frequency, or the recent window's click-through / hook rate decaying against the
 * longer window. Returns a 0-1 score plus the signals behind it (for the evidence trail).
 */
export function fatigue(d14: Derived, d3: Derived) {
  const signals: string[] = [];
  let score = 0;
  if (d3.frequency !== null && d3.frequency >= 3) {
    signals.push(`frequency ${d3.frequency.toFixed(1)} over the last 3 days`);
    score += Math.min(0.5, (d3.frequency - 2.5) / 5);
  }
  const decay = (recent: number | null, base: number | null) =>
    recent !== null && base !== null && base > 0 ? (base - recent) / base : null;
  const ctrDecay = decay(d3.link_ctr ?? d3.ctr, d14.link_ctr ?? d14.ctr);
  if (ctrDecay !== null && ctrDecay >= 0.25) {
    signals.push(`click-through down ${Math.round(ctrDecay * 100)}% vs 14 days`);
    score += Math.min(0.3, ctrDecay / 2);
  }
  const hookDecay = decay(d3.hook_rate, d14.hook_rate);
  if (hookDecay !== null && hookDecay >= 0.25) {
    signals.push(`hook rate down ${Math.round(hookDecay * 100)}% vs 14 days`);
    score += Math.min(0.3, hookDecay / 2);
  }
  return { score: Math.min(1, Number(score.toFixed(2))), signals };
}

/** Rounded, human-readable version of derived metrics, for prompts and evidence. */
export function present(d: Derived) {
  const pct = (v: number | null, digits = 2) => (v === null ? "n/a" : `${(v * 100).toFixed(digits)}%`);
  const usd = (v: number | null) => (v === null ? "n/a" : `$${v.toFixed(2)}`);
  return {
    spend: usd(d.spend_usd),
    impressions: d.impressions,
    ctr: pct(d.ctr),
    link_ctr: pct(d.link_ctr),
    cpm: usd(d.cpm_usd),
    frequency: d.frequency === null ? "n/a" : d.frequency.toFixed(2),
    hook_rate: pct(d.hook_rate, 1),
    hold_rate: pct(d.hold_rate, 1),
    cost_per_thruplay: usd(d.cost_per_thruplay_usd),
    avg_watch: d.avg_watch_s === null ? "n/a" : `${d.avg_watch_s.toFixed(1)}s`,
    retention: d.retention
      ? `25% ${pct(d.retention.p25, 0)} · 50% ${pct(d.retention.p50, 0)} · 75% ${pct(d.retention.p75, 0)} · 100% ${pct(d.retention.p100, 0)}`
      : "n/a",
    booked_calls: d.booked_calls,
    cost_per_booked_call: d.cost_per_booked_call_usd === null ? "none yet" : usd(d.cost_per_booked_call_usd),
    page_visits: d.visits,
    visit_to_booking: pct(d.visit_to_booking, 1),
  };
}

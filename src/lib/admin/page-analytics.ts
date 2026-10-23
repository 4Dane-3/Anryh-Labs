// Page analytics for one agent's booking page, built from page_events (see lib/booking/track.ts).
// Pure: the API route loads the rows, this turns them into the funnel and breakdowns, so every number
// is unit-tested.

export type EventRow = { session_id: string; name: string; meta: Record<string, unknown> | null; created_at: string };

export const FUNNEL = [
  { key: "view", label: "Opened the page", names: ["view"] },
  { key: "see_calendar", label: "Saw the times", names: ["see_calendar"] },
  { key: "picked", label: "Picked a time", names: ["pick_time", "pick_soonest"] },
  { key: "form_start", label: "Started their details", names: ["form_start"] },
  { key: "submit", label: "Pressed Confirm", names: ["submit"] },
  { key: "booked", label: "Booked", names: ["booked"] },
] as const;

export type PageAnalytics = {
  days: number;
  sessions: number;
  booked: number;
  conversion: number | null; // booked / sessions
  medianSeconds: number | null;
  mobileShare: number | null;
  soonestShare: number | null; // of visits that picked a time, how many used "Soonest available"
  funnel: { key: string; label: string; sessions: number; pct: number | null; fromPrev: number | null }[];
  biggestDrop: { from: string; to: string; lost: number } | null;
  scroll: { depth: number; pct: number | null }[];
  sources: { source: string; sessions: number; booked: number }[];
  daily: { date: string; sessions: number; booked: number }[];
  extras: { stickyClicks: number; bioExpands: number; errors: number };
  recent: { at: string; source: string; device: string; furthest: string; seconds: number | null; booked: boolean }[];
};

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
};
const ratio = (a: number, b: number) => (b ? a / b : null);

/** The page's analytics over `days` (ending `now`), with days bucketed in the agent's timezone. */
export function pageAnalytics(rows: EventRow[], days: number, timezone: string, now = new Date()): PageAnalytics {
  const bySession = new Map<string, EventRow[]>();
  for (const r of rows) bySession.set(r.session_id, [...(bySession.get(r.session_id) ?? []), r]);
  // A visit counts once it opened the page (events from a visit that started before the window are dropped)
  const visits = [...bySession.values()]
    .filter((ev) => ev.some((e) => e.name === "view"))
    .map((ev) => ev.sort((a, b) => a.created_at.localeCompare(b.created_at)));

  const has = (ev: EventRow[], names: readonly string[]) => ev.some((e) => names.includes(e.name));
  const reached = FUNNEL.map((f) => visits.filter((ev) => has(ev, f.names)).length);
  const sessions = visits.length;
  const funnel = FUNNEL.map((f, i) => ({
    key: f.key,
    label: f.label,
    sessions: reached[i],
    pct: ratio(reached[i], sessions),
    fromPrev: i === 0 ? null : ratio(reached[i], reached[i - 1]),
  }));
  let biggestDrop: PageAnalytics["biggestDrop"] = null;
  for (let i = 1; i < funnel.length; i++) {
    const lost = reached[i - 1] - reached[i];
    if (lost > 0 && (!biggestDrop || lost > biggestDrop.lost)) biggestDrop = { from: funnel[i - 1].label, to: funnel[i].label, lost };
  }

  const viewMeta = (ev: EventRow[]) => (ev.find((e) => e.name === "view")?.meta ?? {}) as { source?: string; device?: string };
  const leaveMs = (ev: EventRow[]) => {
    const l = ev.filter((e) => e.name === "leave").map((e) => Number((e.meta as { ms?: number } | null)?.ms ?? NaN)).filter(Number.isFinite);
    return l.length ? Math.max(...l) : null;
  };
  const booked = reached[FUNNEL.length - 1];
  const seconds = visits.map(leaveMs).filter((x): x is number => x !== null).map((ms) => Math.round(ms / 1000));
  const mobile = visits.filter((ev) => viewMeta(ev).device === "mobile").length;
  const picked = visits.filter((ev) => has(ev, ["pick_time", "pick_soonest"]));
  const soonest = picked.filter((ev) => has(ev, ["pick_soonest"])).length;

  const scroll = [25, 50, 75, 100].map((depth) => ({
    depth,
    pct: ratio(visits.filter((ev) => ev.some((e) => e.name === "scroll" && Number((e.meta as { depth?: number } | null)?.depth) >= depth)).length, sessions),
  }));

  const sourceMap = new Map<string, { sessions: number; booked: number }>();
  for (const ev of visits) {
    const s = String(viewMeta(ev).source ?? "direct").toLowerCase();
    const key = s === "meta" || s === "facebook" || s === "fb" || s === "ig" || s === "instagram" ? "meta ads" : s;
    const cur = sourceMap.get(key) ?? { sessions: 0, booked: 0 };
    cur.sessions++;
    if (has(ev, ["booked"])) cur.booked++;
    sourceMap.set(key, cur);
  }

  const dayKey = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: timezone });
  const daily = Array.from({ length: days }, (_, i) => {
    const d = dayKey(new Date(now.getTime() - (days - 1 - i) * 86_400_000).toISOString());
    return { date: d, sessions: 0, booked: 0 };
  });
  for (const ev of visits) {
    const row = daily.find((d) => d.date === dayKey(ev[0].created_at));
    if (!row) continue;
    row.sessions++;
    if (has(ev, ["booked"])) row.booked++;
  }

  const furthest = (ev: EventRow[]) => {
    for (let i = FUNNEL.length - 1; i >= 0; i--) if (has(ev, FUNNEL[i].names)) return FUNNEL[i].label;
    return FUNNEL[0].label;
  };
  const count = (name: string) => rows.filter((r) => r.name === name).length;

  return {
    days,
    sessions,
    booked,
    conversion: ratio(booked, sessions),
    medianSeconds: median(seconds),
    mobileShare: ratio(mobile, sessions),
    soonestShare: ratio(soonest, picked.length),
    funnel,
    biggestDrop,
    scroll,
    sources: [...sourceMap].map(([source, v]) => ({ source, ...v })).sort((a, b) => b.sessions - a.sessions),
    daily,
    extras: { stickyClicks: count("sticky_click"), bioExpands: count("bio_expand"), errors: count("booking_error") },
    recent: visits
      .slice()
      .sort((a, b) => b[0].created_at.localeCompare(a[0].created_at))
      .slice(0, 20)
      .map((ev) => {
        const ms = leaveMs(ev);
        return {
          at: ev[0].created_at,
          source: String(viewMeta(ev).source ?? "direct"),
          device: String(viewMeta(ev).device ?? "?"),
          furthest: furthest(ev),
          seconds: ms === null ? null : Math.round(ms / 1000),
          booked: has(ev, ["booked"]),
        };
      }),
  };
}

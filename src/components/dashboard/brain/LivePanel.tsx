"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, animate, motion, useReducedMotion } from "framer-motion";
import { DateTime } from "luxon";
import { isPulse, type BrainEvent, type LiveStats } from "@/lib/migz/brain-types";
import { TIER } from "@/components/dashboard/brain/model";
import { Meter } from "@/components/dashboard/brain/parts";
import { Badge, EmptyState, Panel } from "@/components/dashboard/ui";
import { cn } from "@/lib/utils";

// The Brain's live layer: today's numbers from Meta (refreshed every minute while the page is open) and
// Migz's check-ins between reviews (real events, see lib/migz/live.ts). Nothing here is simulated.

export const LIVE_REFRESH_MS = 60_000;
const PULSE_EVERY_MIN = 10;
/** Tells the event poller a check-in may be starting, so it polls fast for a moment. */
export const PULSE_KICK = "migz:pulse-kick";

const usd = (c: number) => `$${(c / 100).toFixed(2)}`;
const int = (n: number) => Math.round(n).toLocaleString("en-US");

function useLiveStats(agentId: string) {
  const [stats, setStats] = useState<LiveStats | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    let stopped = false;
    const tick = async () => {
      if (document.visibilityState === "visible") {
        try {
          const res = await fetch("/api/dashboard/brain/live", { cache: "no-store" });
          if (res.ok) {
            const next = (await res.json()) as LiveStats;
            // Another account answered (see useBrainLive): reload rather than show its numbers here
            if (next.agentId && next.agentId !== agentId) {
              stopped = true;
              window.location.reload();
              return;
            }
            setStats(next);
            setFailed(false);
            window.dispatchEvent(new Event(PULSE_KICK));
          } else setFailed(true);
        } catch {
          setFailed(true);
        }
      }
      if (!stopped) timer = setTimeout(tick, LIVE_REFRESH_MS);
    };
    tick();
    const onVisible = () => document.visibilityState === "visible" && (clearTimeout(timer), tick());
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [agentId]);
  return { stats, failed };
}

/** Counts from the last real value to the new one, so a refresh reads as movement. */
function Ticker({ value, format }: { value: number; format: (n: number) => string }) {
  const reduce = useReducedMotion();
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    if (reduce) {
      from.current = value;
      const id = requestAnimationFrame(() => setShown(value));
      return () => cancelAnimationFrame(id);
    }
    const controls = animate(from.current, value, { duration: 1.1, ease: [0.22, 1, 0.36, 1], onUpdate: setShown });
    from.current = value;
    return () => controls.stop();
  }, [value, reduce]);
  return <>{format(shown)}</>;
}

/** Briefly lights its children when `value` changes after a refresh. */
function Flash({ value, children, className }: { value: string | number; children: React.ReactNode; className?: string }) {
  const reduce = useReducedMotion();
  return (
    <motion.span
      key={value}
      initial={reduce ? false : { backgroundColor: "rgba(242, 166, 90, 0.22)" }}
      animate={{ backgroundColor: "rgba(242, 166, 90, 0)" }}
      transition={{ duration: 1.6 }}
      className={cn("rounded px-1 -mx-1", className)}
    >
      {children}
    </motion.span>
  );
}

function Tile({ label, children, sub }: { label: string; children: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="min-w-0 rounded-lg border border-line bg-ink px-3.5 py-3">
      <p className="font-mono text-[11px] text-fg-faint">{label}</p>
      <p className="mt-1 truncate font-mono text-lg text-fg tabular-nums">{children}</p>
      {sub && <div className="mt-1 truncate font-mono text-[11px] text-fg-muted">{sub}</div>}
    </div>
  );
}

const HOUR_LABEL = (h: number) => DateTime.fromObject({ hour: h }).toFormat("ha").toLowerCase();

/** Spend by hour today: one series, so no legend; hover any hour for its numbers. */
function HourBars({ hours, nowHour }: { hours: LiveStats["hours"]; nowHour: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const byHour = new Map(hours.map((h) => [h.hour, h]));
  const max = Math.max(1, ...hours.map((h) => h.spendCents));
  const W = 480, H = 96, slot = W / 24, bar = slot - 4;
  const hovered = hover !== null ? (byHour.get(hover) ?? { hour: hover, spendCents: 0, impressions: 0 }) : null;
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H + 18}`} className="h-auto w-full" role="img" aria-label="Spend by hour today">
        <line x1={0} x2={W} y1={H} y2={H} stroke="rgb(255 255 255 / 0.1)" />
        {Array.from({ length: 24 }, (_, h) => {
          const d = byHour.get(h);
          const height = d && d.spendCents > 0 ? Math.max(3, (d.spendCents / max) * (H - 6)) : 0;
          const x = h * slot + 2;
          const future = h > nowHour;
          return (
            <g key={h} onMouseEnter={() => setHover(h)} onMouseLeave={() => setHover(null)}>
              <rect x={h * slot} y={0} width={slot} height={H} fill="transparent" />
              {height > 0 ? (
                <path
                  d={`M${x} ${H} V${H - height + 4} q0 -4 4 -4 h${bar - 8} q4 0 4 4 V${H} Z`}
                  fill={TIER.sonnet.color}
                  opacity={hover === null || hover === h ? 1 : 0.45}
                  className={h === nowHour ? "animate-pulse" : undefined}
                />
              ) : (
                <circle cx={x + bar / 2} cy={H - 2} r={1.5} fill={future ? "rgb(255 255 255 / 0.08)" : "rgb(255 255 255 / 0.22)"} />
              )}
              {h % 6 === 0 && (
                <text x={x + bar / 2} y={H + 13} textAnchor="middle" className="fill-fg-faint font-mono text-[10px]">
                  {HOUR_LABEL(h)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {hovered && (
        <div
          className="pointer-events-none absolute -top-2 z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-md border border-line-strong bg-ink px-2.5 py-1.5 font-mono text-[11px] text-fg shadow-lg"
          style={{ left: `${((hovered.hour + 0.5) / 24) * 100}%` }}
        >
          <p className="text-fg-muted">{HOUR_LABEL(hovered.hour)}{hovered.hour === nowHour ? " · now" : ""}</p>
          <p>{usd(hovered.spendCents)} · {int(hovered.impressions)} impressions</p>
        </div>
      )}
    </div>
  );
}

/** Ticks once a second so countdowns stay true between refreshes. */
function useClock() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

/** Seconds until the next refresh, as a thin ring. */
function RefreshRing({ at }: { at: string | null }) {
  const now = useClock();
  if (!at) return null;
  const age = Math.max(0, now - new Date(at).getTime());
  const left = Math.max(0, 1 - age / LIVE_REFRESH_MS);
  const r = 6, c = 2 * Math.PI * r;
  return (
    <span className="flex items-center gap-1.5 font-mono text-[11px] text-fg-faint">
      <svg viewBox="0 0 16 16" className="size-3.5 -rotate-90" aria-hidden>
        <circle cx={8} cy={8} r={r} fill="none" stroke="rgb(255 255 255 / 0.1)" strokeWidth={2} />
        <circle cx={8} cy={8} r={r} fill="none" stroke={TIER.code.color} strokeWidth={2} strokeDasharray={c} strokeDashoffset={c * (1 - left)} strokeLinecap="round" />
      </svg>
      updated {Math.round(age / 1000)}s ago
    </span>
  );
}

const FLAG: Record<string, { label: string; tone: "good" | "accent" | "neutral" }> = {
  steady: { label: "steady", tone: "good" },
  watch: { label: "watching", tone: "accent" },
  review: { label: "for next review", tone: "accent" },
};

/** Migz's check-ins between reviews: Meta → memory → Sonnet, newest first. */
function WatchFeed({ events }: { events: BrainEvent[] }) {
  const reduce = useReducedMotion();
  const now = useClock();
  const notes = events.filter((e) => isPulse(e) && e.step === "watching").slice(-6).reverse();
  const last = events.filter(isPulse).at(-1);
  const open = events.filter((e) => isPulse(e) && !e.finished_at).at(-1);
  const nextAt = last ? DateTime.fromISO(last.started_at).plus({ minutes: PULSE_EVERY_MIN }) : null;
  return (
    <div className="min-w-0">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <p className="font-mono text-[11px] text-fg-faint">Check-ins</p>
        <p className="font-mono text-[11px] text-fg-faint">
          {open ? (
            <span style={{ color: TIER[open.tier].color }}>{open.summary.toLowerCase()}…</span>
          ) : nextAt ? (
            `next ${nextAt.toMillis() <= now ? "any moment" : nextAt.toRelative({ base: DateTime.fromMillis(now) })}`
          ) : (
            "first check starting"
          )}
        </p>
      </div>
      {notes.length ? (
        <ol className="space-y-2">
          <AnimatePresence initial={false}>
            {notes.map((e, i) => {
              const flag = FLAG[String(e.evidence?.flag ?? "steady")] ?? FLAG.steady;
              return (
                <motion.li
                  key={e.id}
                  layout={!reduce}
                  initial={reduce ? false : { opacity: 0, y: -6 }}
                  animate={{ opacity: i === 0 ? 1 : 0.7, y: 0 }}
                  className="rounded-md border border-line bg-ink px-3 py-2.5"
                >
                  <div className="flex items-center gap-2 font-mono text-[11px] text-fg-faint">
                    <span className="size-1.5 rounded-full" style={{ backgroundColor: TIER[e.tier].color }} />
                    {e.tier === "code" ? "code" : TIER[e.tier].label}
                    <span>· {DateTime.fromISO(e.started_at).toFormat("h:mm a")}</span>
                    {e.tier !== "code" && <Badge tone={flag.tone} className="ml-auto">{flag.label}</Badge>}
                  </div>
                  <p className="mt-1 text-[13px] text-fg">{e.finished_at ? e.summary : <span className="animate-pulse text-fg-muted">thinking…</span>}</p>
                </motion.li>
              );
            })}
          </AnimatePresence>
        </ol>
      ) : (
        <p className="rounded-md border border-dashed border-line px-3 py-4 text-[12px] text-fg-muted">
          While this page is open, Migz checks in every {PULSE_EVERY_MIN} minutes: it reads today&apos;s numbers from Meta, recalls what your account has taught it, and Sonnet notes how today compares. It never changes anything between reviews.
        </p>
      )}
    </div>
  );
}

export function LivePanel({ events, agentId }: { events: BrainEvent[]; agentId: string }) {
  const { stats, failed } = useLiveStats(agentId);
  const reduce = useReducedMotion();
  if (stats && !stats.connected)
    return (
      <Panel>
        <EmptyState title="Live numbers appear once Meta is connected">Connect your ad account in Settings and Migz shows today&apos;s spend and results here as they come in.</EmptyState>
      </Panel>
    );
  const t = stats?.today;
  return (
    <Panel>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold text-fg">
            <span className="relative flex size-2">
              {!reduce && <span className="absolute inline-flex size-full animate-ping rounded-full opacity-60" style={{ backgroundColor: TIER.code.color }} />}
              <span className="relative inline-flex size-2 rounded-full" style={{ backgroundColor: TIER.code.color }} />
            </span>
            Live monitor
          </h2>
          <p className="mt-0.5 text-[13px] text-fg-muted">Today so far, straight from Meta. Meta reports spend a few minutes behind.</p>
        </div>
        {failed ? <span className="font-mono text-[11px] text-bad">couldn&apos;t refresh · retrying</span> : <RefreshRing at={stats?.at ?? null} />}
      </div>

      {stats?.error && <p className="border-b border-line px-5 py-2 font-mono text-[11px] text-bad">Meta didn&apos;t answer this time ({stats.error.slice(0, 120)}). The numbers below may be a minute old.</p>}

      <div className="grid grid-cols-2 gap-2.5 px-5 pt-4 sm:grid-cols-3 lg:grid-cols-6">
        <Tile
          label="Spent today"
          sub={t ? (t.budgetCents ? <Meter value={t.spendCents} max={t.budgetCents} color={TIER.sonnet.color} /> : "no live ad sets") : null}
        >
          {t ? <Flash value={t.spendCents}><Ticker value={t.spendCents} format={usd} /></Flash> : "–"}
          {t?.budgetCents ? <span className="ml-1 text-[11px] text-fg-faint">/ {usd(t.budgetCents)}</span> : null}
        </Tile>
        <Tile label="Impressions" sub={t ? `${int(t.reach)} people reached` : null}>
          {t ? <Flash value={t.impressions}><Ticker value={t.impressions} format={int} /></Flash> : "–"}
        </Tile>
        <Tile label="Link clicks" sub={t?.ctr !== null && t ? `${(t.ctr * 100).toFixed(2)}% click rate` : "no impressions yet"}>
          {t ? <Flash value={t.linkClicks}><Ticker value={t.linkClicks} format={int} /></Flash> : "–"}
        </Tile>
        <Tile label="Per 1,000 impressions" sub={t?.cpcCents !== null && t ? `${usd(t.cpcCents)} per link click` : "–"}>
          {t?.cpmCents != null ? <Ticker value={t.cpmCents} format={usd} /> : "–"}
        </Tile>
        <Tile label="Booked calls today" sub="from your ads">
          {t ? <Flash value={t.bookedCalls}>{t.bookedCalls}</Flash> : "–"}
        </Tile>
        <Tile
          label="Migz thinking today"
          sub={
            stats
              ? { normal: "model calls · full speed", saving: "model calls · research paused for today", light: "model calls · lighter models until midnight" }[stats.migz.pace]
              : null
          }
        >
          {stats ? <Flash value={stats.migz.callsToday}><Ticker value={stats.migz.callsToday} format={int} /></Flash> : "–"}
        </Tile>
      </div>

      <div className="grid gap-6 px-5 py-5 lg:grid-cols-[1.2fr_1fr_1fr]">
        <div className="min-w-0">
          <div className="mb-2 flex items-baseline justify-between">
            <p className="font-mono text-[11px] text-fg-faint">Spend by hour</p>
            {stats?.batch && (
              <p className="font-mono text-[11px] text-fg-faint">
                batch day {stats.batch.day} of {stats.batch.days} · {usd(stats.batch.spentCents)} of {usd(stats.batch.budgetCents)}
              </p>
            )}
          </div>
          {stats ? <HourBars hours={stats.hours} nowHour={stats.hourNow} /> : <div className="h-24 animate-pulse rounded-md bg-white/[0.03]" />}
          {stats?.batch && (
            <div className="mt-3">
              <Meter value={stats.batch.spentCents} max={stats.batch.budgetCents} color={TIER.sonnet.color} />
            </div>
          )}
        </div>

        <div className="min-w-0">
          <p className="mb-2 font-mono text-[11px] text-fg-faint">Spending now</p>
          {stats?.ads.some((a) => !a.paused) ? (
            <ul className="space-y-2.5">
              {stats.ads.filter((a) => !a.paused).map((a) => (
                <li key={a.adId} className="min-w-0">
                  <div className="flex items-baseline justify-between gap-3 font-mono text-[12px]">
                    <span className="truncate text-fg">{a.name}</span>
                    <Flash value={a.spendCents} className="shrink-0 text-fg">{usd(a.spendCents)}</Flash>
                  </div>
                  <div className="mt-1">
                    <Meter value={a.spendCents} max={Math.max(1, stats.today.spendCents)} color={TIER.sonnet.color} />
                  </div>
                  <p className="mt-0.5 font-mono text-[11px] text-fg-faint">{int(a.impressions)} impressions · {a.linkClicks} link clicks</p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="rounded-md border border-dashed border-line px-3 py-4 text-[12px] text-fg-muted">{stats ? "No ad has spent yet today." : "Reading Meta…"}</p>
          )}
          {!!stats?.pausedAds?.length && (
            <div className="mt-5">
              <p className="mb-2 font-mono text-[11px] text-fg-faint">Paused</p>
              <ul className="space-y-2">
                {stats.pausedAds.map((a) => (
                  <li key={a.adId} className="min-w-0">
                    <div className="flex items-baseline justify-between gap-3 font-mono text-[12px]">
                      <span className="truncate text-fg-muted">{a.name}</span>
                      <span className="shrink-0 text-fg-faint">{a.spendCents ? `${usd(a.spendCents)} today` : "paused"}</span>
                    </div>
                    {a.impressions > 0 && (
                      <p className="mt-0.5 font-mono text-[11px] text-fg-faint">{int(a.impressions)} impressions · {a.linkClicks} link clicks before it was paused</p>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <WatchFeed events={events} />
      </div>
    </Panel>
  );
}

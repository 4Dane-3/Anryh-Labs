"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { DateTime } from "luxon";
import { isPulse, type BrainEvent, type BrainLive } from "@/lib/migz/brain-types";
import { TIER } from "@/components/dashboard/brain/model";
import { openEvents, type GraphState } from "@/components/dashboard/brain/state";
import { cn } from "@/lib/utils";

/** True state, never invented: running now, or last reviewed X ago and next in Y. */
export function StatusLine({ live, demo }: { live: BrainLive; demo: boolean }) {
  const last = live.lastRun;
  const latest = live.events.at(-1);
  if (live.running)
    return (
      <p className="flex items-center gap-2 font-mono text-[12px] text-fg">
        <span className="size-1.5 animate-pulse rounded-full bg-brand" />
        {demo ? "sample run" : "reviewing now"}
        {latest && <span className="truncate text-fg-muted">· {latest.summary}</span>}
      </p>
    );
  // Background work outside a review: a creative being made, an ad being built in Meta
  const working = openEvents(live).at(-1);
  if (working)
    return (
      <p className="flex items-center gap-2 font-mono text-[12px] text-fg">
        <span className="size-1.5 animate-pulse rounded-full" style={{ backgroundColor: TIER[working.tier].color }} />
        working
        <span className="truncate text-fg-muted">· {working.summary}</span>
      </p>
    );
  const when = last?.finished_at ?? last?.started_at;
  const pulse = live.events.filter(isPulse).at(-1);
  const watching = !demo && pulse && new Date(live.now).getTime() - new Date(pulse.started_at).getTime() < 15 * 60_000;
  return (
    <p className="font-mono text-[12px] text-fg-muted">
      {watching ? (
        <>
          <span className="mr-1.5 inline-block size-1.5 animate-pulse rounded-full align-middle" style={{ backgroundColor: TIER.code.color }} />
          <span className="text-fg">monitoring live</span> · checked in {DateTime.fromISO(pulse.started_at).toRelative()}
        </>
      ) : (
        "idle"
      )}{" "}
      · {when ? `last reviewed ${DateTime.fromISO(when).toRelative()}` : "no reviews yet"}
      {last?.status === "skipped" && " (quiet: nothing material changed)"}
      {last?.status === "failed" && " (failed)"}
      {live.nextRunAt ? ` · next check ${DateTime.fromISO(live.nextRunAt).toRelative()}` : " · Migz is off"}
    </p>
  );
}

export function PipelineStrip({ graph }: { graph: GraphState }) {
  return (
    <ol className="grid grid-cols-9 gap-1 font-mono text-[10px] sm:text-[11px]">
      {graph.pipeline.map((p, i) => (
        <li key={p.stage} className="min-w-0">
          <div className="relative h-1 overflow-hidden rounded-full bg-white/[0.08]">
            {p.status !== "idle" && (
              <motion.div
                className="absolute inset-0 rounded-full"
                style={{ transformOrigin: "left", backgroundColor: p.status === "active" ? "#f2a65a" : "rgb(242 166 90 / 0.45)" }}
                initial={{ scaleX: 0 }}
                animate={{ scaleX: 1 }}
                transition={{ duration: 0.4, delay: i * 0.03 }}
              />
            )}
          </div>
          <p className={cn("mt-1.5 truncate", p.status === "active" ? "text-fg" : p.status === "done" ? "text-fg-muted" : "text-fg-faint")}>{p.stage}</p>
        </li>
      ))}
    </ol>
  );
}

const NUMBER_KEYS = ["spend", "booked_calls", "critical", "warn", "matches", "reason", "lever", "min_impressions", "hook", "error", "issue"];

function evidenceLine(e: BrainEvent) {
  const ev = e.evidence ?? {};
  const bits: string[] = [];
  for (const k of NUMBER_KEYS) {
    const v = (ev as Record<string, unknown>)[k];
    if (v === undefined || v === null || typeof v === "object") continue;
    bits.push(`${k.replace(/_/g, " ")} ${String(v)}`);
  }
  const counts = (ev as { counts?: Record<string, number> }).counts;
  if (counts) bits.push(`${counts.critical} critical · ${counts.warn} warn · ${counts.info} info`);
  if (e.input_tokens || e.output_tokens) bits.push(`${(e.input_tokens + e.output_tokens).toLocaleString("en-US")} tokens`);
  return bits.slice(0, 3).join(" · ");
}

/** The findings stream: each step with the numbers behind it. No chain of thought, ever. */
export function SessionLog({ events, max = 40 }: { events: BrainEvent[]; max?: number }) {
  const reduce = useReducedMotion();
  // Live check-ins have their own feed in the live monitor
  const rows = events.filter((e) => !isPulse(e)).slice(-max).reverse();
  if (!rows.length) return <p className="px-5 py-8 text-center text-sm text-fg-muted">No activity yet. Steps appear here as Migz works.</p>;
  return (
    <ol className="divide-y divide-line font-mono text-[12px]">
      <AnimatePresence initial={false}>
        {rows.map((e) => (
          <motion.li
            key={e.id}
            layout={!reduce}
            initial={reduce ? false : { opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25 }}
            className="grid grid-cols-[64px_74px_1fr] gap-3 px-5 py-2.5"
          >
            <span className="text-fg-faint">{DateTime.fromISO(e.started_at).toFormat("HH:mm:ss")}</span>
            <span style={{ color: TIER[e.tier].color }} className="truncate">
              {e.tier === "code" ? "code" : e.tier}
              {!e.finished_at && <span className="ml-1 animate-pulse">…</span>}
            </span>
            <span className="min-w-0">
              <span className="text-fg">{e.summary}</span>
              {evidenceLine(e) && <span className="mt-0.5 block truncate text-fg-faint">{evidenceLine(e)}</span>}
            </span>
          </motion.li>
        ))}
      </AnimatePresence>
    </ol>
  );
}

export function Meter({ value, max, color }: { value: number; max: number; color: string }) {
  const w = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.07]">
      <motion.div className="h-full rounded-full" style={{ backgroundColor: color }} initial={{ width: 0 }} animate={{ width: `${w}%` }} transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }} />
    </div>
  );
}

"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { DateTime } from "luxon";
import { ArrowUpRight, Radio } from "lucide-react";
import { isPulse, type BrainEvent, type BrainLive } from "@/lib/migz/brain-types";
import { STAGE_OF, TIER } from "@/components/dashboard/brain/model";
import { openEvents } from "@/components/dashboard/brain/state";
import { useBrainLive } from "@/components/dashboard/brain/useBrainLive";
import { cn } from "@/lib/utils";

// What each stage of a review means, in plain words
const DOING: Record<string, string> = {
  sense: "Reading Meta",
  audit: "Checking setup",
  research: "Researching",
  triage: "Deciding",
  watch: "Watching",
  advise: "Advising",
  create: "Drafting",
  act: "Changing ads",
  remember: "Taking notes",
};

const label = (e: BrainEvent) => (e.tier === "higgsfield" ? "Making a creative" : (DOING[STAGE_OF[e.step] ?? ""] ?? "Working"));
const clock = (iso: string) => DateTime.fromISO(iso).toFormat("h:mm a");

function took(e: BrainEvent) {
  if (!e.finished_at) return "now";
  const s = Math.max(1, Math.round((new Date(e.finished_at).getTime() - new Date(e.started_at).getTime()) / 1000));
  return s < 60 ? `${s}s` : `${Math.round(s / 60)}m`;
}

/** One line of truth: reviewing now, working on something, or when it last checked and checks next. */
function status(live: BrainLive, now: number) {
  if (live.running) return { busy: true, text: "Reviewing your campaign now" };
  const working = openEvents(live, now).at(-1);
  if (working) return { busy: true, text: `${label(working)}: ${working.summary}` };
  const when = live.lastRun?.finished_at ?? live.lastRun?.started_at;
  const pulse = live.events.filter(isPulse).at(-1);
  const watching = pulse && now - new Date(pulse.started_at).getTime() < 15 * 60_000;
  const parts = [
    watching ? "Watching your ads live" : when ? `Checked ${DateTime.fromISO(when).toRelative()}` : "No reviews yet",
    live.nextRunAt ? `next review ${DateTime.fromISO(live.nextRunAt).toRelative()}` : "Migz AI is off",
  ];
  return { busy: !!watching, text: parts.join(" · ") };
}

/** How busy each half hour of the last day was: the little ruler under each step. */
function Ruler({ events, now }: { events: BrainEvent[]; now: number }) {
  const bins = new Array(48).fill(0);
  for (const e of events) {
    const ago = (now - new Date(e.started_at).getTime()) / 1_800_000;
    if (ago >= 0 && ago < 48) bins[47 - Math.floor(ago)] += 1;
  }
  const max = Math.max(1, ...bins);
  return (
    <span className="mt-3 flex h-4 items-end gap-[3px]" aria-hidden="true">
      {bins.map((n, i) => (
        <i key={i} className={cn("min-w-px flex-1 rounded-[1px]", n ? "bg-white/60" : "bg-white/20")} style={{ height: `${n ? 35 + (n / max) * 65 : 25}%` }} />
      ))}
    </span>
  );
}

function Step({ e, events, now }: { e: BrainEvent; events: BrainEvent[]; now: number }) {
  return (
    <div className="rounded-2xl border border-white/20 bg-white/10 px-4 pb-3 pt-3.5">
      <div className="mb-2.5 flex items-baseline justify-between gap-3">
        <p className="text-[15px] font-medium text-fg">{label(e)}</p>
        <span className="inline-flex shrink-0 items-center gap-1.5 text-[12px] text-fg-muted">
          <i className="size-1.5 rounded-full" style={{ backgroundColor: TIER[e.tier].color }} />
          {TIER[e.tier].label}
        </span>
      </div>
      <p className="line-clamp-2 text-[13px] leading-snug text-fg-muted">{e.summary}</p>
      <div className="mt-3 flex items-end justify-between gap-2">
        <div>
          <p className="text-[11px] text-fg-faint">Started</p>
          <p className="text-lg font-normal leading-none tracking-tight text-fg">{clock(e.started_at)}</p>
        </div>
        <span className="mb-0.5 rounded-full bg-white/15 px-2 py-0.5 text-[11px] text-fg">{took(e)}</span>
        <div className="text-right">
          <p className="text-[11px] text-fg-faint">{e.finished_at ? "Done" : "Working"}</p>
          <p className="text-lg font-normal leading-none tracking-tight text-fg">{e.finished_at ? clock(e.finished_at) : "…"}</p>
        </div>
      </div>
      <Ruler events={events} now={now} />
    </div>
  );
}

/** The glass card of Migz AI at work: what it's doing now and its last couple of steps, live. */
export function BrainCard({ live, className }: { live: BrainLive; className?: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(id);
  }, []);
  const s = status(live, now);
  // Review steps first; the all-day check-ins only when there's nothing else to show
  const steps = useMemo(() => {
    const real = live.events.filter((e) => !isPulse(e));
    return (real.length ? real : live.events).slice(-2).reverse();
  }, [live.events]);

  return (
    <div
      className={cn(
        "rounded-[26px] border border-white/20 bg-[rgb(200_204_200/0.14)] px-4 pb-4 pt-3 text-fg shadow-[0_20px_60px_-20px_rgb(0_0_0/0.5)] backdrop-blur-2xl",
        className,
      )}
    >
      <span className="mx-auto mb-3 block h-1 w-14 rounded-full bg-white/80" aria-hidden="true" />
      <p className="mb-3 flex items-center gap-2 px-1 text-[13px] text-fg-muted">
        <Radio className={cn("size-3.5 shrink-0", s.busy ? "animate-pulse text-brand" : "text-fg-faint")} aria-hidden="true" />
        <span className="shrink-0 font-medium text-fg">Migz AI Brain</span>
        <span className="truncate">· {s.text}</span>
      </p>
      {steps.length ? (
        <div className="space-y-2.5">
          {steps.map((e) => (
            <Step key={e.id} e={e} events={live.events} now={now} />
          ))}
        </div>
      ) : (
        <p className="rounded-2xl border border-white/20 bg-white/10 px-4 py-6 text-center text-[13px] text-fg-muted">
          Migz AI hasn&apos;t run yet. Its steps show here as it works.
        </p>
      )}
      <Link href="/dashboard/brain" className="mt-3 inline-flex items-center gap-1 px-1 text-[13px] text-fg-muted transition-colors hover:text-fg">
        Open the brain <ArrowUpRight className="size-3.5" />
      </Link>
    </div>
  );
}

/** BrainCard with live polling, for a page that already has the first snapshot (Overview). */
export function LiveBrainCard({ initial, className }: { initial: BrainLive; className?: string }) {
  const live = useBrainLive(initial, false);
  return <BrainCard live={live} className={className} />;
}

/** BrainCard for anywhere else: loads the first snapshot itself, then polls. */
export function FetchedBrainCard({ className }: { className?: string }) {
  const [initial, setInitial] = useState<BrainLive | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let gone = false;
    fetch("/api/dashboard/brain", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: BrainLive) => !gone && setInitial(d))
      .catch(() => !gone && setFailed(true));
    return () => {
      gone = true;
    };
  }, []);
  if (initial) return <LiveBrainCard initial={initial} className={className} />;
  return (
    <div className={cn("rounded-[26px] border border-white/20 bg-[rgb(200_204_200/0.14)] px-4 py-8 text-center text-[13px] text-fg-muted backdrop-blur-2xl", className)}>
      {failed ? "Couldn't reach Migz AI just now." : "Checking on Migz AI…"}
    </div>
  );
}

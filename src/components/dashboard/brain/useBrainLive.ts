"use client";

import { useEffect, useRef, useState } from "react";
import type { BrainEvent, BrainLive } from "@/lib/migz/brain-types";
import { DEMO_SCRIPT } from "@/components/dashboard/brain/demo";

const MAX_EVENTS = 120;

/**
 * Real events, polled: every 2.5s while a review runs, every 30s when idle (and paused while the tab
 * is hidden). Demo mode replays a labelled sample run instead and never touches the account's data.
 */
export function useBrainLive(initial: BrainLive, demo: boolean, justStarted = false) {
  const [live, setLive] = useState(initial);
  const state = useRef(initial);
  // Right after "Review now" the run row may not exist yet: poll fast for a couple of minutes
  const fastUntil = useRef(0);

  useEffect(() => {
    if (demo) return;
    if (justStarted) fastUntil.current = Date.now() + 120_000;
    let timer: ReturnType<typeof setTimeout>;
    let stopped = false;
    const tick = async () => {
      const cur = state.current;
      if (document.visibilityState === "visible") {
        // Re-read from the oldest still-open step so steps close when they finish
        const open = cur.events.filter((e) => !e.finished_at && e.run_id === cur.runId).map((e) => e.id);
        const after = open.length ? Math.min(...open) - 1 : cur.events.at(-1)?.id ?? 0;
        try {
          const res = await fetch(`/api/dashboard/brain?after=${after}`, { cache: "no-store" });
          if (res.ok) {
            const next = (await res.json()) as BrainLive;
            const byId = new Map(cur.events.map((e) => [e.id, e]));
            for (const e of next.events) byId.set(e.id, e);
            const merged: BrainLive = { ...next, events: [...byId.values()].sort((x, y) => x.id - y.id).slice(-MAX_EVENTS) };
            state.current = merged;
            setLive(merged);
          }
        } catch {
          // offline for a moment: try again next tick
        }
      }
      if (!stopped) timer = setTimeout(tick, state.current.running || Date.now() < fastUntil.current ? 2500 : 30_000);
    };
    timer = setTimeout(tick, state.current.running || justStarted ? 1500 : 30_000);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [demo, justStarted]);

  const demoLive = useDemo(demo);
  return demo ? demoLive : live;
}

function useDemo(on: boolean): BrainLive {
  // Clock lives in state (set from an effect) so render stays pure
  const [clock, setClock] = useState({ t: 0, at: 0 });
  useEffect(() => {
    if (!on) return;
    const started = Date.now();
    const tick = () => setClock({ t: Math.floor((Date.now() - started) / 1000), at: Date.now() });
    const first = setTimeout(tick, 0);
    const id = setInterval(tick, 1000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [on]);
  const cycle = DEMO_SCRIPT.at(-1)!.at + 8;
  const now = clock.t % cycle;
  const base = clock.at - now * 1000;
  const events: BrainEvent[] = DEMO_SCRIPT.filter((e) => e.at <= now).map((e, i) => ({
    id: i + 1,
    run_id: "demo",
    step: e.step,
    tier: e.tier,
    model: e.model ?? null,
    summary: e.summary,
    evidence: e.evidence ?? {},
    input_tokens: e.tokens ?? 0,
    output_tokens: 0,
    started_at: new Date(base + e.at * 1000).toISOString(),
    finished_at: e.at + (e.dur ?? 1.5) <= now ? new Date(base + (e.at + (e.dur ?? 1.5)) * 1000).toISOString() : null,
  }));
  const running = now < DEMO_SCRIPT.at(-1)!.at + 1;
  return {
    now: new Date(clock.at).toISOString(),
    running,
    runId: "demo",
    lastRun: { status: running ? "running" : "succeeded", started_at: new Date(base).toISOString(), finished_at: running ? null : new Date(clock.at).toISOString(), summary: null, skipped_reason: null },
    nextRunAt: new Date(clock.at + 6 * 3_600_000).toISOString(),
    mode: "auto",
    events,
  };
}

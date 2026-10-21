"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowRight } from "lucide-react";
import type { BrainLive } from "@/lib/migz/brain-types";
import { PipelineStrip, StatusLine } from "@/components/dashboard/brain/parts";
import { TIER } from "@/components/dashboard/brain/model";
import { deriveGraph } from "@/components/dashboard/brain/state";
import { useBrainLive } from "@/components/dashboard/brain/useBrainLive";
import { Panel } from "@/components/dashboard/ui";

/** Compact live view for Overview: status, the pipeline, and the last few steps. */
export function BrainWidget({ initial }: { initial: BrainLive }) {
  const live = useBrainLive(initial, false);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const graph = useMemo(() => deriveGraph(live, now), [live, now]);
  const recent = live.events.slice(-3).reverse();
  return (
    <Panel className="overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3">
        <StatusLine live={live} demo={false} />
        <Link href="/dashboard/brain" className="inline-flex shrink-0 items-center gap-1 text-[13px] text-fg-muted hover:text-fg">
          Brain <ArrowRight className="size-3.5" />
        </Link>
      </div>
      <div className="space-y-4 px-5 py-4">
        <PipelineStrip graph={graph} />
        {recent.length > 0 && (
          <ul className="space-y-1.5 font-mono text-[12px]">
            {recent.map((e) => (
              <li key={e.id} className="flex gap-3">
                <span className="w-16 shrink-0" style={{ color: TIER[e.tier].color }}>{e.tier}</span>
                <span className="truncate text-fg-muted">{e.summary}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Panel>
  );
}

"use client";

import { useRef } from "react";
import { motion, useAnimationFrame, useReducedMotion } from "framer-motion";
import { DateTime } from "luxon";
import { BOX, LINKS, NODE_COPY, NODE_TIER, PATHS, ROUTE, TIER, type NodeId } from "@/components/dashboard/brain/model";
import type { GraphState } from "@/components/dashboard/brain/state";
import { cn } from "@/lib/utils";

const W = 1000;
const H = 590;
const pct = (v: number, of: number) => `${(v / of) * 100}%`;

/** A light travelling along one connector, positioned each frame from the real SVG path. */
function Pulse({ d, color, delay, duration, dim = 1, size = 4.5, bounce = false }: { d: string; color: string; delay: number; duration: number; dim?: number; size?: number; bounce?: boolean }) {
  const path = useRef<SVGPathElement>(null);
  const dot = useRef<SVGCircleElement>(null);
  const trail = useRef<SVGCircleElement>(null);
  useAnimationFrame((t) => {
    const p = path.current;
    if (!p || !dot.current || !trail.current) return;
    const len = p.getTotalLength();
    const raw = (((t / 1000 - delay) % duration) + duration) % duration / duration;
    // bounce: there and back (a conversation between two nodes) instead of one way
    const phase = bounce ? (raw < 0.5 ? raw * 2 : (1 - raw) * 2) : raw;
    const at = p.getPointAtLength(phase * len);
    const back = p.getPointAtLength(Math.max(0, Math.min(len, phase * len + (bounce && raw >= 0.5 ? 10 : -10))));
    dot.current.setAttribute("cx", String(at.x));
    dot.current.setAttribute("cy", String(at.y));
    trail.current.setAttribute("cx", String(back.x));
    trail.current.setAttribute("cy", String(back.y));
    const fade = (phase < 0.08 ? phase / 0.08 : phase > 0.92 ? (1 - phase) / 0.08 : 1) * dim;
    dot.current.setAttribute("opacity", String(fade));
    trail.current.setAttribute("opacity", String(fade * 0.35));
  });
  return (
    <g>
      <path ref={path} d={d} fill="none" stroke="none" />
      <circle ref={trail} r={size * 0.66} fill={color} opacity={0} />
      <circle ref={dot} r={size} fill={color} opacity={0} />
    </g>
  );
}

function Connector({ id, lit, color }: { id: string; lit: boolean; color: string }) {
  return (
    <path
      d={PATHS[id]}
      fill="none"
      stroke={lit ? color : "rgb(255 255 255 / 0.12)"}
      strokeOpacity={lit ? 0.55 : 1}
      strokeWidth={lit ? 1.6 : 1.2}
      strokeDasharray={id === "opus-sonnet" ? "3 5" : id === "sonnet-code" || id === "spine" ? "2 4" : undefined}
      style={{ transition: "stroke 300ms ease, stroke-opacity 300ms ease" }}
    />
  );
}

function NodeBox({ id, graph }: { id: NodeId; graph: GraphState }) {
  const b = BOX[id];
  const n = graph.nodes[id];
  const tier = TIER[NODE_TIER[id]];
  const copy = NODE_COPY[id];
  const active = n.status === "active";
  return (
    <div
      className={cn(
        "absolute flex flex-col rounded-md border px-3 py-2.5 font-mono text-[11px] leading-snug transition-[border-color,background-color] duration-300",
        n.status === "idle" ? "border-white/10 bg-ink" : "bg-ink",
        active ? "brain-glow z-10" : n.status === "done" && "brain-glow-soft",
      )}
      style={{
        left: pct(b.x, W),
        top: pct(b.y, H),
        width: pct(b.w, W),
        height: pct(b.h, H),
        borderColor: n.status === "idle" ? undefined : `${tier.color}${active ? "" : "80"}`,
        ["--glow" as string]: tier.color,
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold text-fg">{copy.title}</span>
        <span className="flex items-center gap-1.5" style={{ color: tier.color }}>
          {NODE_TIER[id] === "haiku" && <span>haiku</span>}
          <motion.span
            className="size-1.5 rounded-full"
            style={{ backgroundColor: n.status === "idle" ? "rgb(255 255 255 / 0.18)" : tier.color }}
            animate={active ? { opacity: [1, 0.35, 1] } : { opacity: 1 }}
            transition={active ? { duration: 1.2, repeat: Infinity } : undefined}
          />
        </span>
      </div>
      <span className="text-fg-faint">{copy.role}</span>
      {id === "opus" ? (
        <OpusBody graph={graph} />
      ) : (
        <span className={cn("mt-auto line-clamp-2", n.last ? "text-fg-muted" : "text-fg-faint")}>
          {n.last ? n.last.summary : "idle"}
        </span>
      )}
    </div>
  );
}

function OpusBody({ graph }: { graph: GraphState }) {
  const last = graph.nodes.opus.last;
  return (
    <div className="mt-4 flex flex-1 flex-col gap-4 text-fg-muted">
      <p>
        <span className="text-[#b7a4ff]">◇</span> before any change to spend
      </p>
      <p className="border-l border-white/10 pl-3 text-fg-faint">
        Reads the whole review: every number, tool call and result. Sonnet must consult it before budgets, pauses, launches or experiments.
      </p>
      <dl className="grid grid-cols-[1fr_auto] gap-y-1">
        <dt>consults this run</dt>
        <dd className="text-right text-fg">{graph.advisorCalls}</dd>
        <dt>last advice</dt>
        <dd className="text-right text-fg">{last ? DateTime.fromISO(last.started_at).toRelative({ style: "narrow" }) : "none"}</dd>
      </dl>
      <p className="text-fg-faint">Advice is encrypted end to end: you see when it happened and what Sonnet did next, not the words.</p>
      <p className="mt-auto text-fg-faint">{graph.skipped ? "silent: quiet run" : "never writes ads itself. Sonnet applies the advice."}</p>
    </div>
  );
}

export function BrainGraph({ graph }: { graph: GraphState }) {
  const reduce = useReducedMotion();
  const lit = new Map<string, string>();
  for (const id of graph.active) for (const p of ROUTE[id]) lit.set(p, TIER[NODE_TIER[id]].color);
  // Nodes that worked this run keep a slow, dim trickle of traffic on their connectors to the hub
  const ambient = new Map<string, string>();
  const busy = (id: NodeId) => graph.nodes[id].status !== "idle";
  for (const id of Object.keys(graph.nodes) as NodeId[])
    if (graph.nodes[id].status === "done") for (const p of ROUTE[id]) if (!lit.has(p) && !ambient.has(p)) ambient.set(p, TIER[NODE_TIER[id]].color);
  const links = LINKS.filter((l) => busy(l.a) && busy(l.b));

  return (
    <div className="relative w-full" style={{ aspectRatio: `${W} / ${H}` }}>
      <svg viewBox={`0 0 ${W} ${H}`} className="absolute inset-0 size-full" aria-hidden="true">
        {Object.keys(PATHS).map((id) => (
          <Connector key={id} id={id} lit={lit.has(id) || ambient.has(id)} color={lit.get(id) ?? ambient.get(id) ?? ""} />
        ))}
        {links.map((l) => (
          <path key={l.id} d={l.d} fill="none" stroke={TIER[NODE_TIER[l.a]].color} strokeOpacity={0.35} strokeWidth={1.1} strokeDasharray="2 4" />
        ))}
        <circle cx={600} cy={444} r={3} fill="rgb(255 255 255 / 0.25)" />
        {!reduce &&
          [...lit].map(([id, color], i) =>
            [0, 1].map((offset) => (
              <Pulse key={`${id}-${offset}`} d={PATHS[id]} color={color} delay={offset + i * 0.2} duration={2.2} dim={0.85} />
            )),
          )}
        {!reduce &&
          [...ambient].map(([id, color], i) => (
            <Pulse key={`amb-${id}`} d={PATHS[id]} color={color} delay={i * 0.9} duration={4.5} dim={0.45} size={3.2} bounce />
          ))}
        {!reduce &&
          links.map((l, i) => (
            <Pulse key={`link-${l.id}`} d={l.d} color={TIER[NODE_TIER[l.b]].color} delay={i * 1.3} duration={5.5} dim={0.55} size={3} bounce />
          ))}
      </svg>
      {(Object.keys(BOX) as NodeId[]).map((id) => (
        <NodeBox key={id} id={id} graph={graph} />
      ))}
    </div>
  );
}

/** Phone layout: the same nodes in one column, with a light running down the rail to the active one. */
export function BrainList({ graph }: { graph: GraphState }) {
  const reduce = useReducedMotion();
  const order: NodeId[] = ["opus", "sonnet", "code", "auditor", "librarian", "scout", "clerk", "higgsfield", "meta", "memory"];
  return (
    <ol className="space-y-2">
      {order.map((id) => {
        const n = graph.nodes[id];
        const tier = TIER[NODE_TIER[id]];
        const active = n.status === "active";
        return (
          <li key={id} className="relative flex gap-3">
            <div className="relative flex w-3 shrink-0 justify-center">
              <span className="absolute inset-y-[-8px] w-px bg-white/10" />
              {n.status !== "idle" && !reduce && (
                <motion.span
                  className="absolute size-2 rounded-full"
                  style={{ backgroundColor: tier.color }}
                  animate={{ top: ["-8px", "calc(100% + 0px)"], opacity: active ? [0, 0.9, 0] : [0, 0.45, 0] }}
                  transition={{ duration: active ? 2.2 : 4.5, repeat: Infinity, ease: "easeInOut", delay: order.indexOf(id) * 0.4 }}
                />
              )}
              <span
                className="relative mt-3 size-2 rounded-full"
                style={{ backgroundColor: n.status === "idle" ? "rgb(255 255 255 / 0.2)" : tier.color }}
              />
            </div>
            <div
              className={cn("min-w-0 flex-1 rounded-md border px-3 py-2 font-mono text-[11px] transition-colors", active ? "brain-glow" : n.status === "done" && "brain-glow-soft")}
              style={{ borderColor: n.status === "idle" ? "rgb(255 255 255 / 0.08)" : `${tier.color}${active ? "" : "70"}`, ["--glow" as string]: tier.color }}
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-semibold text-fg">{NODE_COPY[id].title}</span>
                <span className="truncate text-fg-faint">{NODE_COPY[id].role}</span>
              </div>
              {id === "opus" ? (
                <p className="mt-1 text-fg-muted">{graph.advisorCalls} consult{graph.advisorCalls === 1 ? "" : "s"} this run · advice stays encrypted</p>
              ) : (
                n.last && <p className="mt-1 line-clamp-2 text-fg-muted">{n.last.summary}</p>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

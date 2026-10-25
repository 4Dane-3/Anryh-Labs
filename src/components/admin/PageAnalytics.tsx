"use client";

import { useEffect, useState } from "react";
import { DateTime } from "luxon";
import { ArrowUpRight } from "lucide-react";
import type { PageAnalytics } from "@/lib/admin/page-analytics";
import { EmptyState, Panel, PanelHeader } from "@/components/dashboard/ui";
import { cn } from "@/lib/utils";

// Staff only: what visitors do on each agent's booking page, to work out where people drop off.

const pct = (v: number | null, d = 0) => (v === null ? "–" : `${(v * 100).toFixed(d)}%`);
const BAR = "#f2a65a";

function Tile({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="min-w-0 rounded-lg border border-line bg-ink px-3.5 py-3">
      <p className="font-mono text-[11px] text-fg-faint">{label}</p>
      <p className="mt-1 font-mono text-lg tabular-nums text-fg">{value}</p>
      {sub && <p className="mt-0.5 truncate font-mono text-[11px] text-fg-muted">{sub}</p>}
    </div>
  );
}

/** One bar per funnel step, as a share of visits, with how many made it from the step before. */
function Funnel({ a }: { a: PageAnalytics }) {
  return (
    <ol className="space-y-2.5">
      {a.funnel.map((f, i) => (
        <li key={f.key}>
          <div className="flex items-baseline justify-between gap-3 text-[12px]">
            <span className="text-fg">{f.label}</span>
            <span className="font-mono tabular-nums text-fg-muted">
              {f.sessions} · {pct(f.pct)}
              {i > 0 && <span className="text-fg-faint"> ({pct(f.fromPrev)} of the step before)</span>}
            </span>
          </div>
          <div className="mt-1 h-2 overflow-hidden rounded-full bg-white/[0.06]">
            <div className="h-full rounded-full" style={{ width: `${(f.pct ?? 0) * 100}%`, backgroundColor: BAR, opacity: 1 - i * 0.1 }} />
          </div>
        </li>
      ))}
    </ol>
  );
}

/** Visits per day: one series, so no legend. Hover a day for visits and bookings. */
function Daily({ a }: { a: PageAnalytics }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...a.daily.map((d) => d.sessions));
  const W = 420, H = 90, slot = W / a.daily.length, bar = Math.max(3, slot - 3);
  const h = hover !== null ? a.daily[hover] : null;
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H + 16}`} className="h-auto w-full" role="img" aria-label="Visits per day">
        <line x1={0} x2={W} y1={H} y2={H} stroke="rgb(255 255 255 / 0.1)" />
        {a.daily.map((d, i) => {
          const height = d.sessions ? Math.max(3, (d.sessions / max) * (H - 6)) : 0;
          const x = i * slot + (slot - bar) / 2;
          return (
            <g key={d.date} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <rect x={i * slot} y={0} width={slot} height={H} fill="transparent" />
              {height > 0 && <rect x={x} y={H - height} width={bar} height={height} rx={Math.min(4, bar / 2)} fill={BAR} opacity={hover === null || hover === i ? 1 : 0.45} />}
              {d.booked > 0 && <circle cx={x + bar / 2} cy={H - height - 6} r={3} fill="#8bcf9f" />}
              {(i === 0 || i === a.daily.length - 1) && (
                <text x={x + bar / 2} y={H + 12} textAnchor={i === 0 ? "start" : "end"} className="fill-fg-faint font-mono text-[10px]">
                  {DateTime.fromISO(d.date).toFormat("LLL d")}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {h && (
        <div
          className="pointer-events-none absolute -top-1 z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-md border border-line-strong bg-ink-high px-2.5 py-1.5 font-mono text-[11px] text-fg shadow-lg"
          style={{ left: `${((hover! + 0.5) / a.daily.length) * 100}%` }}
        >
          {DateTime.fromISO(h.date).toFormat("ccc LLL d")} · {h.sessions} visit{h.sessions === 1 ? "" : "s"} · {h.booked} booked
        </div>
      )}
      <p className="mt-1 font-mono text-[11px] text-fg-faint"><span className="mr-1 inline-block size-2 rounded-full bg-good align-middle" />a day with a booking</p>
    </div>
  );
}

export function PageAnalyticsPanel({ agents }: { agents: { id: string; name: string; slug: string }[] }) {
  const [agentId, setAgentId] = useState(agents.find((a) => a.slug === "miguel-cruz")?.id ?? agents[0]?.id ?? "");
  const [days, setDays] = useState<7 | 30>(7);
  const [data, setData] = useState<(PageAnalytics & { ready: true }) | { ready: false } | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!agentId) return;
    let live = true;
    const load = async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/admin/page-analytics?agent=${agentId}&days=${days}`, { cache: "no-store" });
        if (res.ok && live) setData(await res.json());
      } finally {
        if (live) setLoading(false);
      }
    };
    load();
    const id = setInterval(load, 60_000);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, [agentId, days]);

  const agent = agents.find((a) => a.id === agentId);
  const a = data && data.ready ? data : null;

  return (
    <Panel>
      <PanelHeader
        title="Page analytics"
        description="What visitors do on each agent's booking page: where they drop off, how far they scroll, how long they stay. No personal data."
        action={
          <div className="flex flex-wrap items-center gap-2">
            <select
              aria-label="Agent"
              value={agentId}
              onChange={(e) => setAgentId(e.target.value)}
              className="rounded-md border border-line bg-ink-high px-2 py-1 text-[12px] text-fg"
            >
              {agents.map((x) => (
                <option key={x.id} value={x.id}>{x.name}</option>
              ))}
            </select>
            <div className="flex rounded-lg border border-line p-0.5 text-[12px]">
              {([7, 30] as const).map((d) => (
                <button key={d} onClick={() => setDays(d)} className={cn("rounded-md px-2.5 py-1", days === d ? "bg-white/[0.08] text-fg" : "text-fg-muted hover:text-fg")}>
                  {d} days
                </button>
              ))}
            </div>
            {agent && (
              <a href={`/${agent.slug}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[12px] text-fg-muted hover:text-fg">
                Open page <ArrowUpRight className="size-3.5" />
              </a>
            )}
          </div>
        }
      />
      {data && !data.ready ? (
        <EmptyState title="Run the page analytics migration">
          Run <code className="break-all font-mono text-[12px]">supabase/migrations/20261104000000_page_events.sql</code>, then visits start showing up here.
        </EmptyState>
      ) : !a ? (
        <div className="h-48 animate-pulse" />
      ) : !a.sessions ? (
        <EmptyState title="No visits in this period">Visits show here as people open {agent?.name ?? "this agent"}&apos;s booking page (preview views from the dashboard don&apos;t count).</EmptyState>
      ) : (
        <div className={cn("space-y-6 p-5", loading && "opacity-80")}>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 lg:grid-cols-7">
            <Tile label="Visits" value={a.sessions} sub={`last ${a.days} days`} />
            <Tile label="Booked" value={a.booked} sub={`${pct(a.conversion, 1)} of visits`} />
            <Tile label="Saw the times" value={pct(a.funnel[1].pct)} sub="booking card came into view" />
            <Tile label="Time on page" value={a.medianSeconds === null ? "–" : `${a.medianSeconds}s`} sub="median" />
            <Tile label="On a phone" value={pct(a.mobileShare)} sub="of visits" />
            <Tile label="Used Soonest" value={pct(a.soonestShare)} sub="of those who picked a time" />
            <Tile label="Tapped Call" value={a.extras.callVisits} sub={a.sessions ? `${pct(a.extras.callVisits / a.sessions, 1)} of visits` : "no visits"} />
          </div>

          {a.biggestDrop && (
            <p className="rounded-md border border-brand/30 bg-brand/[0.06] px-3 py-2 text-[13px] text-fg">
              Biggest drop-off: <span className="font-semibold">{a.biggestDrop.from}</span> → <span className="font-semibold">{a.biggestDrop.to}</span> ({a.biggestDrop.lost} visit{a.biggestDrop.lost === 1 ? "" : "s"} lost here)
            </p>
          )}

          <div className="grid gap-6 lg:grid-cols-2">
            <div>
              <p className="mb-3 font-mono text-[11px] text-fg-faint">Booking funnel</p>
              <Funnel a={a} />
            </div>
            <div className="space-y-6">
              <div>
                <p className="mb-2 font-mono text-[11px] text-fg-faint">Visits per day</p>
                <Daily a={a} />
              </div>
              <div>
                <p className="mb-2 font-mono text-[11px] text-fg-faint">How far they scrolled</p>
                <div className="grid grid-cols-4 gap-2">
                  {a.scroll.map((s) => (
                    <div key={s.depth} className="rounded-md border border-line bg-ink px-2 py-2 text-center">
                      <p className="font-mono text-[11px] text-fg-faint">{s.depth}%</p>
                      <p className="font-mono text-sm text-fg">{pct(s.pct)}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="grid gap-6 lg:grid-cols-[1fr_1.6fr]">
            <div>
              <p className="mb-2 font-mono text-[11px] text-fg-faint">Where visits came from</p>
              <table className="w-full text-left font-mono text-[12px]">
                <thead className="text-fg-faint">
                  <tr className="border-b border-line"><th className="py-1.5 font-normal">Source</th><th className="py-1.5 font-normal">Visits</th><th className="py-1.5 font-normal">Booked</th></tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {a.sources.map((s) => (
                    <tr key={s.source}><td className="py-1.5 text-fg">{s.source}</td><td className="py-1.5">{s.sessions}</td><td className="py-1.5">{s.booked}</td></tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-3 font-mono text-[11px] text-fg-muted">
                {a.extras.stickyClicks} sticky-bar taps · {a.extras.callTaps} call taps · {a.extras.bioExpands} bio &quot;Read more&quot; · {a.extras.errors} booking errors
              </p>
            </div>
            <div className="min-w-0">
              <p className="mb-2 font-mono text-[11px] text-fg-faint">Recent visits</p>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[460px] text-left font-mono text-[12px]">
                  <thead className="text-fg-faint">
                    <tr className="border-b border-line">
                      {["When", "Source", "Device", "Got as far as", "Stayed"].map((h) => <th key={h} className="py-1.5 pr-3 font-normal">{h}</th>)}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {a.recent.map((r) => (
                      <tr key={r.at + r.source}>
                        <td className="py-1.5 pr-3 text-fg-muted">{DateTime.fromISO(r.at).toRelative()}</td>
                        <td className="py-1.5 pr-3">{r.source}</td>
                        <td className="py-1.5 pr-3">{r.device}</td>
                        <td className={cn("py-1.5 pr-3", r.booked ? "text-good" : "text-fg")}>{r.furthest}</td>
                        <td className="py-1.5 pr-3">{r.seconds === null ? "–" : `${r.seconds}s`}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}
    </Panel>
  );
}

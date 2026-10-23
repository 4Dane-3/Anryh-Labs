"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { DateTime } from "luxon";
import { ArrowUpRight, BellRing, BrainCircuit, Check, RefreshCw, ShieldCheck } from "lucide-react";
import type { AdminAlert, AdminOverview, AdminAgentRow } from "@/lib/admin/types";
import type { Severity } from "@/lib/admin/issues";
import { resolveAlert, scanNow, setAgentModelBudget } from "@/app/admin/actions";
import { TIER } from "@/components/dashboard/brain/model";
import { PageAnalyticsPanel } from "@/components/admin/PageAnalytics";
import { Badge, Button, EmptyState, inputClass, Panel, PanelHeader } from "@/components/dashboard/ui";
import { cn } from "@/lib/utils";

const REFRESH_MS = 30_000;
const usd = (c: number) => `$${(c / 100).toFixed(c % 100 ? 2 : 0)}`;
const rel = (iso: string, now: number) => DateTime.fromISO(iso).toRelative({ base: DateTime.fromMillis(now) }) ?? "";

const SEV: Record<Severity, { label: string; tone: "bad" | "accent" | "neutral"; dot: string }> = {
  critical: { label: "critical", tone: "bad", dot: "bg-bad" },
  warn: { label: "warning", tone: "accent", dot: "bg-brand" },
  info: { label: "info", tone: "neutral", dot: "bg-fg-faint" },
};

function useOverview(initial: AdminOverview) {
  const [data, setData] = useState(initial);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const clock = setInterval(() => setNow(Date.now()), 1000);
    let timer: ReturnType<typeof setTimeout>;
    let stopped = false;
    const tick = async () => {
      if (document.visibilityState === "visible") {
        try {
          const res = await fetch("/api/admin/overview", { cache: "no-store" });
          if (res.ok) setData((await res.json()) as AdminOverview);
        } catch {
          // try again next tick
        }
      }
      if (!stopped) timer = setTimeout(tick, REFRESH_MS);
    };
    timer = setTimeout(tick, REFRESH_MS);
    return () => {
      stopped = true;
      clearInterval(clock);
      clearTimeout(timer);
    };
  }, []);
  return { data, setData, now };
}

function Stat({ label, value, sub, tone }: { label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: "bad" | "accent" }) {
  return (
    <div className="min-w-0 rounded-lg border border-line bg-ink-raised px-4 py-3">
      <p className="font-mono text-[11px] text-fg-faint">{label}</p>
      <p className={cn("mt-1 font-mono text-xl tabular-nums", tone === "bad" ? "text-bad" : tone === "accent" ? "text-brand" : "text-fg")}>{value}</p>
      {sub && <p className="mt-0.5 truncate font-mono text-[11px] text-fg-muted">{sub}</p>}
    </div>
  );
}

const viewHref = (slug: string, to = "/dashboard") => `/admin/view/${slug}${to === "/dashboard" ? "" : `?to=${encodeURIComponent(to)}`}`;

function AlertRow({ alert, now, onResolved }: { alert: AdminAlert; now: number; onResolved: (id: number) => void }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const s = SEV[alert.severity];
  return (
    <li className="flex items-start gap-3 px-5 py-3">
      <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", s.dot, alert.severity === "critical" && !alert.resolvedAt && "animate-pulse")} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <p className={cn("text-[13px] font-medium", alert.resolvedAt ? "text-fg-muted" : "text-fg")}>{alert.title}</p>
          <span className="text-[12px] text-fg-muted">· {alert.agentName}</span>
        </div>
        {alert.detail && <p className="mt-0.5 line-clamp-2 text-[12px] text-fg-muted">{alert.detail}</p>}
        <p className="mt-1 flex flex-wrap items-center gap-x-2 font-mono text-[11px] text-fg-faint">
          <span>{alert.resolvedAt ? `${alert.resolvedBy === "auto" ? "cleared on its own" : `handled by ${alert.resolvedBy}`} ${rel(alert.resolvedAt, now)}` : `since ${rel(alert.firstSeen, now)}`}</span>
          {alert.slackSentAt && (
            <span className="inline-flex items-center gap-1">
              <BellRing className="size-3" /> Slack pinged
            </span>
          )}
          {alert.source === "event" && <span>reported by Migz</span>}
        </p>
        {error && <p className="mt-1 text-[12px] text-bad">{error}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {alert.agentSlug && (
          <a href={viewHref(alert.agentSlug, "/dashboard/brain")} className="rounded-md px-2 py-1 text-[12px] text-fg-muted hover:bg-white/[0.05] hover:text-fg">
            Look
          </a>
        )}
        {!alert.resolvedAt && (
          <Button
            size="sm"
            variant="secondary"
            disabled={pending}
            onClick={() =>
              start(async () => {
                setError(null);
                const r = await resolveAlert(alert.id);
                if (r.ok) onResolved(alert.id);
                else setError(r.error);
              })
            }
          >
            <Check className="size-3.5" /> Handled
          </Button>
        )}
      </div>
    </li>
  );
}

function AlertsPanel({ data, now, onResolved }: { data: AdminOverview; now: number; onResolved: (id: number) => void }) {
  const [tab, setTab] = useState<"open" | "recent">("open");
  const order: Record<Severity, number> = { critical: 0, warn: 1, info: 2 };
  const open = [...data.open].sort((a, b) => order[a.severity] - order[b.severity] || b.firstSeen.localeCompare(a.firstSeen));
  const rows = tab === "open" ? open : data.recent;
  return (
    <Panel>
      <PanelHeader
        title="Alerts"
        description="Problems Migz spots on every account, checked every 10 minutes. New critical and warning alerts ping your Slack."
        action={
          <div className="flex rounded-lg border border-line p-0.5 text-[12px]">
            {(["open", "recent"] as const).map((t) => (
              <button key={t} onClick={() => setTab(t)} className={cn("rounded-md px-2.5 py-1", tab === t ? "bg-white/[0.08] text-fg" : "text-fg-muted hover:text-fg")}>
                {t === "open" ? `Open (${open.length})` : "Resolved"}
              </button>
            ))}
          </div>
        }
      />
      {!data.alertsReady ? (
        <EmptyState title="Run the admin alerts migration">Run <code className="break-all font-mono text-[12px]">supabase/migrations/20261102000000_admin_alerts.sql</code>, then alerts start appearing here within 10 minutes.</EmptyState>
      ) : rows.length ? (
        <ul className="max-h-[560px] divide-y divide-line overflow-y-auto">
          {rows.map((a) => (
            <AlertRow key={a.id} alert={a} now={now} onResolved={onResolved} />
          ))}
        </ul>
      ) : (
        <EmptyState title={tab === "open" ? "All clear" : "Nothing resolved lately"}>
          {tab === "open" ? "No problems on any account right now. Migz checks again every 10 minutes." : "Alerts that clear on their own or that you mark handled show here for 3 days."}
        </EmptyState>
      )}
    </Panel>
  );
}

function ActivityPanel({ data, now }: { data: AdminOverview; now: number }) {
  const reduce = useReducedMotion();
  return (
    <Panel>
      <PanelHeader title="Live activity" description="What Migz is doing on every account, newest first." />
      <ol className="max-h-[560px] divide-y divide-line overflow-y-auto font-mono text-[12px]">
        <AnimatePresence initial={false}>
          {data.activity.map((e) => (
            <motion.li key={e.id} layout={!reduce} initial={reduce ? false : { opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} className="px-5 py-2.5">
              <div className="flex items-center gap-2 text-[11px] text-fg-faint">
                <span className={cn("size-1.5 rounded-full", e.open && "animate-pulse")} style={{ backgroundColor: TIER[e.tier]?.color ?? "#888" }} />
                <span className="truncate text-fg-muted">{e.agentName}</span>
                <span className="ml-auto shrink-0">{rel(e.at, now)}</span>
              </div>
              <p className="mt-0.5 line-clamp-2 text-fg">
                {e.summary}
                {e.open && <span className="ml-1 animate-pulse text-fg-muted">…</span>}
              </p>
            </motion.li>
          ))}
        </AnimatePresence>
      </ol>
    </Panel>
  );
}

function Health({ a }: { a: AdminAgentRow }) {
  const sev: Severity | null = a.alerts.critical ? "critical" : a.alerts.warn ? "warn" : null;
  const count = a.alerts.critical + a.alerts.warn;
  return (
    <span className="flex items-center gap-1.5">
      <span className={cn("size-2 rounded-full", sev ? SEV[sev].dot : "bg-good", sev === "critical" && "animate-pulse")} />
      <span className={cn("text-[12px]", sev === "critical" ? "text-bad" : sev === "warn" ? "text-brand" : "text-fg-muted")}>{count ? `${count} issue${count === 1 ? "" : "s"}` : "healthy"}</span>
    </span>
  );
}

function AgentsPanel({ data, now }: { data: AdminOverview; now: number }) {
  return (
    <Panel>
      <PanelHeader title="Agents" description="Every account, live. Open one to see their dashboard exactly as they do (view only)." />
      <div className="overflow-x-auto">
        <table className="w-full min-w-[980px] text-left text-[13px]">
          <thead className="font-mono text-[11px] text-fg-faint">
            <tr className="border-b border-line">
              {["Agent", "Health", "Migz", "Batch", "Spent today", "Ads live", "Balance", "Last review", ""].map((h) => (
                <th key={h} className="px-4 py-2 font-normal first:pl-5">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {data.agents.map((a) => (
              <tr key={a.id} className="align-top">
                <td className="px-4 py-3 pl-5">
                  <p className="font-medium text-fg">{a.name}</p>
                  <p className="font-mono text-[11px] text-fg-faint">/{a.slug}{!a.slack && a.setupDone ? " · no Slack" : ""}</p>
                  {a.working && <p className="mt-1 line-clamp-1 max-w-[220px] font-mono text-[11px] text-brand"><span className="animate-pulse">●</span> {a.working}</p>}
                </td>
                <td className="px-4 py-3"><Health a={a} /></td>
                <td className="px-4 py-3">
                  <Badge tone={a.mode === "off" ? "neutral" : a.mode === "auto" ? "good" : "accent"}>{!a.setupDone ? "setting up" : a.mode === "approve" ? "ask first" : a.mode}</Badge>
                </td>
                <td className="px-4 py-3 font-mono text-[12px]">
                  {a.batch ? (
                    <>
                      <p className="text-fg">day {a.batch.day}/{a.batch.days}</p>
                      <p className="text-fg-faint">{usd(a.batch.spentCents)} of {usd(a.batch.budgetCents)}</p>
                    </>
                  ) : (
                    <span className="text-fg-faint">none</span>
                  )}
                </td>
                <td className="px-4 py-3 font-mono text-[12px]">
                  {a.today ? (
                    <>
                      <p className="text-fg">{usd(a.today.spendCents)}<span className="text-fg-faint"> / {usd(a.today.budgetCents)}</span></p>
                      <p className="text-fg-faint">{a.today.impressions.toLocaleString("en-US")} impr · {a.today.linkClicks} clicks{a.today.bookedCalls ? ` · ${a.today.bookedCalls} booked` : ""}</p>
                    </>
                  ) : a.metaError ? (
                    <span className="text-bad">Meta error</span>
                  ) : (
                    <span className="text-fg-faint">{a.connected ? "–" : "no Meta"}</span>
                  )}
                </td>
                <td className="px-4 py-3 font-mono text-[12px] text-fg">{a.liveAds}</td>
                <td className="px-4 py-3 font-mono text-[12px] text-fg">{usd(a.balanceCents)}</td>
                <td className="px-4 py-3 font-mono text-[12px]">
                  {a.lastRun ? (
                    <>
                      <p className={a.lastRun.status === "failed" ? "text-bad" : "text-fg"}>{a.lastRun.status}</p>
                      <p className="text-fg-faint">{rel(a.lastRun.at, now)}</p>
                    </>
                  ) : (
                    <span className="text-fg-faint">never</span>
                  )}
                </td>
                <td className="px-4 py-3 pr-5">
                  <div className="flex justify-end gap-1.5">
                    <a href={viewHref(a.slug, "/dashboard/brain")} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[12px] text-fg-muted hover:bg-white/[0.05] hover:text-fg" title="Their Migz brain">
                      <BrainCircuit className="size-3.5" /> Brain
                    </a>
                    <a href={viewHref(a.slug)} className="inline-flex items-center gap-1 rounded-md bg-white/[0.06] px-2.5 py-1 text-[12px] font-medium text-fg hover:bg-white/[0.1]">
                      View <ArrowUpRight className="size-3.5" />
                    </a>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function Dot({ on }: { on: boolean }) {
  return <span className={cn("size-2 shrink-0 rounded-full", on ? "bg-good" : "bg-fg-faint")} />;
}

/** Monthly AI budget for one agent: the cap on Migz's model costs. Over it, work moves to cheaper models. */
function BudgetEditor({ agent }: { agent: AdminAgentRow }) {
  const [value, setValue] = useState(String(agent.modelBudgetCents / 100));
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const budget = agent.modelBudgetCents / 100;
  const used = budget > 0 ? Math.min(1, agent.modelSpentUsd / budget) : 1;
  const save = () =>
    start(async () => {
      setMsg(null);
      const r = await setAgentModelBudget(agent.id, Math.round(Number(value) * 100));
      setMsg(r.ok ? { ok: true, text: "Saved" } : { ok: false, text: r.error });
    });
  return (
    <div>
      <p className="font-mono text-[11px] text-fg-faint">AI budget · dollars per month</p>
      <div className="mt-1.5 flex gap-2">
        <input aria-label={`AI budget for ${agent.name}`} inputMode="decimal" className={cn(inputClass, "max-w-[140px]")} value={value} onChange={(e) => setValue(e.target.value)} />
        <Button size="sm" onClick={save} disabled={pending}>Save</Button>
        {msg && <span className={cn("self-center text-[12px]", msg.ok ? "text-good" : "text-bad")}>{msg.text}</span>}
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/[0.07]">
        <div className={cn("h-full rounded-full", used >= 1 ? "bg-bad" : used >= 0.8 ? "bg-brand" : "bg-good")} style={{ width: `${used * 100}%` }} />
      </div>
      <p className="mt-1 font-mono text-[11px] text-fg-muted">${agent.modelSpentUsd.toFixed(2)} used this month of ${budget.toFixed(2)}. Over it, Migz moves work to cheaper models instead of stopping.</p>
    </div>
  );
}

/** Staff only: what each account is connected to and its AI budget. Agents never see any of this. */
function AccountsPanel({ data }: { data: AdminOverview }) {
  return (
    <Panel>
      <PanelHeader title="Accounts & AI budgets" description="Connections and each agent's monthly AI budget. Only you can see this." />
      <div className="border-b border-line px-5 py-4">
        <p className="mb-2 font-mono text-[11px] text-fg-faint">Services (shared by every account)</p>
        <ul className="grid gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
          {data.services.map((s) => (
            <li key={s.key} className="flex items-center gap-2.5">
              <Dot on={s.on} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] text-fg">{s.name}</span>
                <span className="block truncate text-[11px] text-fg-faint">{s.detail}</span>
              </span>
              <span className={cn("text-[11px]", s.on ? "text-good" : "text-bad")}>{s.on ? "Connected" : "Not connected"}</span>
            </li>
          ))}
        </ul>
      </div>
      <ul className="divide-y divide-line">
        {data.agents.map((a) => (
          <li key={a.id} className="grid gap-5 px-5 py-4 lg:grid-cols-[1fr_1.2fr]">
            <div className="min-w-0">
              <p className="text-[13px] font-medium text-fg">{a.name} <span className="font-mono text-[11px] font-normal text-fg-faint">/{a.slug}</span></p>
              <ul className="mt-2 space-y-1.5 text-[12px]">
                <li className="flex items-center gap-2"><Dot on={!!a.adAccount} /><span className="text-fg-muted">Ad account</span><span className="min-w-0 truncate font-mono text-fg">{a.adAccount ?? "not linked"}</span></li>
                <li className="flex items-center gap-2"><Dot on={!!a.pageId} /><span className="text-fg-muted">Facebook Page</span><span className="min-w-0 truncate font-mono text-fg">{a.pageId ?? "not linked"}</span></li>
                <li className="flex items-center gap-2"><Dot on={!!a.instagramId} /><span className="text-fg-muted">Instagram</span><span className="min-w-0 truncate font-mono text-fg">{a.instagramId ?? "not linked"}</span></li>
                <li className="flex items-center gap-2"><Dot on={a.slack} /><span className="text-fg-muted">Slack updates</span><span className="text-fg">{a.slack ? "connected" : "not connected"}</span></li>
              </ul>
            </div>
            <BudgetEditor agent={a} />
          </li>
        ))}
      </ul>
    </Panel>
  );
}

export function AdminView({ initial }: { initial: AdminOverview }) {
  const { data, setData, now } = useOverview(initial);
  const [pending, start] = useTransition();
  const [note, setNote] = useState<string | null>(null);
  const critical = data.open.filter((a) => a.severity === "critical").length;
  const warn = data.open.filter((a) => a.severity === "warn").length;
  const age = Math.round((now - new Date(data.at).getTime()) / 1000);

  const refresh = async () => {
    const res = await fetch("/api/admin/overview", { cache: "no-store" });
    if (res.ok) setData((await res.json()) as AdminOverview);
  };

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6 px-4 pb-16 pt-6 sm:px-8 lg:pt-10">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="flex items-center gap-1.5 font-mono text-[11px] text-brand">
            <ShieldCheck className="size-3.5" /> Anryh Labs staff
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Admin</h1>
          <p className="mt-1 max-w-xl text-sm text-fg-muted">Every agent&apos;s account at a glance, what Migz is doing right now, and anything failing or paused.</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1.5 font-mono text-[11px] text-fg-faint">
            <span className="size-1.5 animate-pulse rounded-full bg-good" /> live · updated {age}s ago
          </span>
          <Button
            size="sm"
            variant="secondary"
            disabled={pending}
            onClick={() =>
              start(async () => {
                setNote(null);
                const r = await scanNow();
                setNote(r.ok ? r.message ?? "Done." : r.error);
                await refresh();
              })
            }
          >
            <RefreshCw className={cn("size-3.5", pending && "animate-spin")} /> {pending ? "Scanning…" : "Scan now"}
          </Button>
          <Link href="/dashboard" className="text-[13px] text-fg-muted hover:text-fg">My dashboard</Link>
        </div>
      </header>
      {note && <p className="font-mono text-[12px] text-fg-muted">{note}</p>}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="Critical" value={critical} tone={critical ? "bad" : undefined} sub={critical ? "needs you now" : "none open"} />
        <Stat label="Warnings" value={warn} tone={warn ? "accent" : undefined} sub={`${data.open.length - critical - warn} info`} />
        <Stat label="Agents" value={data.agents.length} sub={`${data.totals.runningBatches} with a running batch`} />
        <Stat label="Spent today, all accounts" value={usd(data.totals.spendTodayCents)} sub={data.totals.budgetTodayCents ? `of ${usd(data.totals.budgetTodayCents)} daily budgets` : "no live ad sets"} />
        <Stat label="Migz working now" value={data.totals.working} sub={data.totals.working ? "accounts with a step running" : "all idle"} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
        <AlertsPanel data={data} now={now} onResolved={(id) => setData((d) => ({ ...d, open: d.open.filter((a) => a.id !== id) }))} />
        <ActivityPanel data={data} now={now} />
      </div>

      <AgentsPanel data={data} now={now} />

      <PageAnalyticsPanel agents={data.agents.map((x) => ({ id: x.id, name: x.name, slug: x.slug }))} />

      <AccountsPanel data={data} />
    </div>
  );
}

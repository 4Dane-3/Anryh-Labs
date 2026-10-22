"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { DateTime } from "luxon";
import { ExternalLink, Trash2 } from "lucide-react";
import type { BrainLive, Scorecard } from "@/lib/migz/brain-types";
import { addSwipe, deleteSwipe, setAdFocus } from "@/app/dashboard/actions";
import { cleanFocus, isTopic, MAX_FOCUS, TOPIC_KEYS, TOPICS, type TopicKey } from "@/lib/migz/topics";
import { BrainGraph, BrainList } from "@/components/dashboard/brain/BrainGraph";
import { TIER } from "@/components/dashboard/brain/model";
import { PipelineStrip, SessionLog, StatusLine } from "@/components/dashboard/brain/parts";
import { deriveGraph } from "@/components/dashboard/brain/state";
import { useBrainLive } from "@/components/dashboard/brain/useBrainLive";
import { Badge, Button, EmptyState, inputClass, Panel, PanelHeader } from "@/components/dashboard/ui";
import { cn } from "@/lib/utils";
import { ApprovalsPanel } from "@/components/dashboard/Proposals";
import type { MigzAction } from "@/lib/dashboard/queries";

type Board = {
  findings: { check_name: string; subject: string; severity: string; summary: string; first_seen: string; status: string }[];
  experiments: { id: string; hypothesis: string; lever: string; success_metric: string; variants: { label: string; ad_id: string | null }[]; min_impressions: number; status: string; verdict: string | null; winner_label: string | null; result: { summary?: string } | null; created_at: string }[];
  learnings: { id: string; insight: string; confidence: string; source: string; created_at: string }[];
  swipes: { id: string; source_url: string | null; advertiser: string | null; notes: string | null; traits: { angle?: string; hook_type?: string; compliance_risk?: string } | null; added_by: string; created_at: string }[];
  scorecards: Scorecard[];
  focus: string[];
  liveByTopic: Record<string, number>;
  cost: { month: string; byTier: Record<"haiku" | "sonnet" | "opus", number>; tokens: Record<"haiku" | "sonnet" | "opus", number>; advisorCalls: number; totalUsd: number; limitUsd: number };
};

const pct = (v: number | null, d = 1) => (v === null ? "–" : `${(v * 100).toFixed(d)}%`);

/** Ticks once a second so "a few seconds ago" and the step lights stay true between polls. */
function useNow() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

export function BrainView({
  initial,
  board,
  agentId,
  justStarted = false,
  approvals = null,
}: {
  initial: BrainLive;
  board: Board;
  agentId: string;
  justStarted?: boolean;
  /** Proposals waiting for the agent (Ask me first mode); null hides the panel. */
  approvals?: MigzAction[] | null;
}) {
  const [demo, setDemo] = useState(false);
  const live = useBrainLive(initial, demo, justStarted);
  const now = useNow();
  const graph = useMemo(() => deriveGraph(live, now), [live, now]);
  void agentId;

  return (
    <div className="space-y-6">
      {approvals && !demo && <ApprovalsPanel proposals={approvals} />}
      <Panel className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3">
          <StatusLine live={live} demo={demo} />
          <div className="flex items-center gap-3">
            {demo && <Badge tone="accent">Sample data, not your account</Badge>}
            <Button size="sm" variant={demo ? "primary" : "secondary"} onClick={() => setDemo((d) => !d)}>
              {demo ? "Back to live" : "Play a sample run"}
            </Button>
          </div>
        </div>
        <div className="space-y-6 px-5 py-5">
          <PipelineStrip graph={graph} />
          <div className="hidden lg:block">
            <BrainGraph graph={graph} />
          </div>
          <div className="lg:hidden">
            <BrainList graph={graph} />
          </div>
          <div className="flex flex-wrap gap-x-5 gap-y-1 font-mono text-[11px] text-fg-faint">
            {Object.entries(TIER).map(([k, t]) => (
              <span key={k} className="flex items-center gap-1.5">
                <span className="size-1.5 rounded-full" style={{ backgroundColor: t.color }} />
                {t.label}
                {k === "opus" && " · advisor"}
                {k === "sonnet" && " · lead"}
                {k === "haiku" && " · crew"}
              </span>
            ))}
          </div>
        </div>
      </Panel>

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <Panel>
          <PanelHeader title="Session log" description="Every step Migz takes, with the numbers behind it." />
          <div className="max-h-[520px] overflow-y-auto">
            <SessionLog events={live.events} />
          </div>
        </Panel>
        <div className="space-y-6">
          <FocusPanel focus={board.focus} liveByTopic={board.liveByTopic} />
          <AuditPanel findings={board.findings} />
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <ExperimentsPanel experiments={board.experiments} />
        <LearningsPanel learnings={board.learnings} />
      </div>

      <ScorecardsPanel cards={board.scorecards} />
      <SwipePanel swipes={board.swipes} />
    </div>
  );
}

function FocusPanel({ focus, liveByTopic }: { focus: string[]; liveByTopic: Record<string, number> }) {
  const router = useRouter();
  const [picked, setPicked] = useState<TopicKey[]>(cleanFocus(focus));
  const [pending, start] = useTransition();
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = picked.join() !== cleanFocus(focus).join();

  const toggle = (key: TopicKey) => {
    setSaved(false);
    setPicked((cur) => (cur.includes(key) ? cur.filter((k) => k !== key) : cur.length >= MAX_FOCUS ? cur : [...cur, key]));
  };
  const save = () =>
    start(async () => {
      setError(null);
      const res = await setAdFocus(picked);
      if (!res.ok) return setError(res.error);
      setSaved(true);
      router.refresh();
    });

  return (
    <Panel>
      <PanelHeader
        title="Ad focus"
        description={`What you want to sell. Pick up to ${MAX_FOCUS}; the first is your main focus. Migz makes new creatives for these.`}
      />
      <div className="space-y-2 px-5 py-4">
        {TOPIC_KEYS.map((key) => {
          const rank = picked.indexOf(key);
          const on = rank >= 0;
          const full = !on && picked.length >= MAX_FOCUS;
          return (
            <button
              key={key}
              type="button"
              onClick={() => toggle(key)}
              disabled={full}
              aria-pressed={on}
              className={cn(
                "flex w-full items-start gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors disabled:opacity-40",
                on ? "border-brand/50 bg-brand/[0.07]" : "border-line hover:border-line-strong hover:bg-white/[0.03]",
              )}
            >
              <span
                className={cn(
                  "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full font-mono text-[11px]",
                  on ? "bg-brand text-brand-fg" : "border border-line-strong text-transparent",
                )}
              >
                {on ? rank + 1 : "·"}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline justify-between gap-2">
                  <span className="text-[13px] font-medium text-fg">{TOPICS[key].label}</span>
                  {(liveByTopic[key] ?? 0) > 0 && <span className="shrink-0 font-mono text-[11px] text-fg-faint">{liveByTopic[key]} live</span>}
                </span>
                <span className="block text-[12px] text-fg-muted">{TOPICS[key].pitch}</span>
              </span>
            </button>
          );
        })}
        <div className="flex items-center gap-3 pt-2">
          <Button variant="primary" size="sm" onClick={save} disabled={pending || !dirty}>
            Save focus
          </Button>
          {saved && !dirty && <span className="text-[12px] text-good">Saved. Migz uses it from the next review.</span>}
          {!picked.length && <span className="text-[12px] text-fg-faint">None picked: Migz chooses from proven angles.</span>}
        </div>
        {error && <p className="text-[12px] text-bad">{error}</p>}
      </div>
    </Panel>
  );
}

const SEV: Record<string, "bad" | "accent" | "neutral" | "good"> = { critical: "bad", warn: "accent", info: "neutral" };

function AuditPanel({ findings }: { findings: Board["findings"] }) {
  const open = findings.filter((f) => f.status === "open");
  const resolved = findings.filter((f) => f.status === "resolved");
  return (
    <Panel>
      <PanelHeader title="Auditor" description={open.length ? `${open.length} open finding${open.length === 1 ? "" : "s"}` : "All checks passing"} />
      {findings.length ? (
        <ul className="divide-y divide-line">
          {[...open, ...resolved.slice(0, 3)].map((f) => (
            <li key={`${f.check_name}-${f.subject}`} className="flex items-start gap-3 px-5 py-3">
              <Badge tone={f.status === "resolved" ? "good" : SEV[f.severity]}>{f.status === "resolved" ? "fixed" : f.severity}</Badge>
              <div className="min-w-0">
                <p className={cn("text-[13px]", f.status === "resolved" ? "text-fg-muted line-through decoration-white/20" : "text-fg")}>{f.summary}</p>
                <p className="mt-0.5 font-mono text-[11px] text-fg-faint">{f.check_name.replace(/_/g, " ")} · since {DateTime.fromISO(f.first_seen).toRelative()}</p>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState title="No findings yet">The auditor checks tracking, your page, pacing and more on every review.</EmptyState>
      )}
    </Panel>
  );
}

function ExperimentsPanel({ experiments }: { experiments: Board["experiments"] }) {
  const cols = [
    { key: "planned", label: "Planned" },
    { key: "running", label: "Running" },
    { key: "concluded", label: "Concluded" },
  ];
  return (
    <Panel>
      <PanelHeader title="Experiments" description="One lever at a time, judged only after every variant has enough data." />
      {experiments.length ? (
        <div className="grid gap-3 p-4 sm:grid-cols-3">
          {cols.map((c) => (
            <div key={c.key} className="min-w-0">
              <p className="mb-2 font-mono text-[11px] text-fg-faint">{c.label}</p>
              <div className="space-y-2">
                {experiments
                  .filter((e) => e.status === c.key)
                  .map((e) => (
                    <motion.div key={e.id} layout className="rounded-md border border-line bg-ink px-3 py-2.5">
                      <p className="text-[12px] text-fg">{e.hypothesis}</p>
                      <p className="mt-1 font-mono text-[11px] text-fg-faint">
                        {e.lever} · {e.success_metric.replace(/_/g, " ")} · {e.variants.length} variants
                      </p>
                      {e.verdict && (
                        <p className="mt-1 text-[11px] text-good">
                          {e.verdict === "winner" ? `${e.winner_label} won` : e.verdict.replace("_", " ")}
                        </p>
                      )}
                    </motion.div>
                  ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState title="No experiments yet">Migz records a hypothesis before it tests a hook, body, copy or placement.</EmptyState>
      )}
    </Panel>
  );
}

function LearningsPanel({ learnings }: { learnings: Board["learnings"] }) {
  return (
    <Panel>
      <PanelHeader title="Learnings" description="What this account has taught Migz. Yours only, never pooled with other agents." />
      {learnings.length ? (
        <ul className="divide-y divide-line">
          {learnings.slice(0, 10).map((l) => (
            <li key={l.id} className="px-5 py-3">
              <p className="text-[13px] text-fg">{l.insight}</p>
              <p className="mt-0.5 font-mono text-[11px] text-fg-faint">
                {l.confidence} confidence · from {l.source} · {DateTime.fromISO(l.created_at).toRelative()}
              </p>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState title="Nothing learned yet">Learnings come from finished experiments and the weekly strategy memo.</EmptyState>
      )}
    </Panel>
  );
}

const RUNG: Record<string, string> = { hook: "fix the hook", body: "fix the body", copy: "test copy", landing: "page / audience", fatigue: "refresh", healthy: "healthy", too_early: "too early" };

function Retention({ r }: { r: Scorecard["retention"] }) {
  if (!r) return <span className="text-fg-faint">–</span>;
  const pts = [1, r.p25 ?? 0, r.p50 ?? 0, r.p75 ?? 0, r.p100 ?? 0];
  const d = pts.map((v, i) => `${i === 0 ? "M" : "L"}${i * 15} ${20 - Math.min(1, v) * 18}`).join(" ");
  return (
    <svg viewBox="0 0 60 22" className="h-5 w-16" aria-label="retention curve">
      <path d={d} fill="none" stroke="#82b4ff" strokeWidth={1.5} />
    </svg>
  );
}

function ScorecardsPanel({ cards }: { cards: Scorecard[] }) {
  return (
    <Panel>
      <PanelHeader title="Creative scorecards" description="Each live ad against its own ad set's average, last 14 days." />
      {cards.length ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left font-mono text-[12px]">
            <thead className="text-fg-faint">
              <tr className="border-b border-line">
                {["Ad", "Hook rate", "Hold rate", "Retention", "Link CTR", "Booked", "Verdict"].map((h) => (
                  <th key={h} className="px-5 py-2 font-normal">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {cards.map((c) => (
                <tr key={c.ad_id}>
                  <td className="max-w-[240px] px-5 py-2.5">
                    <p className="truncate text-fg">{c.hook || c.name}</p>
                    <p className="truncate text-[11px] text-fg-faint">{c.kind ?? "ad"}{c.topic && isTopic(c.topic) ? ` · ${TOPICS[c.topic].label}` : c.traits?.angle ? ` · ${c.traits.angle}` : ""}</p>
                  </td>
                  <td className="px-5">{pct(c.hook_rate)}</td>
                  <td className="px-5">{pct(c.hold_rate)}</td>
                  <td className="px-5"><Retention r={c.retention} /></td>
                  <td className="px-5">{pct(c.link_ctr, 2)}</td>
                  <td className="px-5">{c.booked_calls}{c.cost_per_booked_call !== null ? <span className="text-fg-faint"> · ${c.cost_per_booked_call.toFixed(0)}</span> : null}</td>
                  <td className="px-5" title={c.verdict.read}>
                    <Badge tone={c.verdict.rung === "healthy" ? "good" : c.verdict.rung === "too_early" ? "neutral" : "accent"}>{RUNG[c.verdict.rung] ?? c.verdict.rung}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState title="No live ads yet">Scorecards appear once ads are running.</EmptyState>
      )}
    </Panel>
  );
}

function SwipePanel({ swipes }: { swipes: Board["swipes"] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [form, setForm] = useState({ url: "", advertiser: "", notes: "" });
  const [error, setError] = useState<string | null>(null);
  const save = () =>
    start(async () => {
      setError(null);
      const res = await addSwipe(form);
      if (!res.ok) setError(res.error);
      else setForm({ url: "", advertiser: "", notes: "" });
      router.refresh();
    });
  return (
    <Panel>
      <PanelHeader title="Swipe file" description="Outside ads Migz studies for ideas. Inspiration only: it never copies wording." />
      <div className="grid gap-6 p-5 lg:grid-cols-[1fr_320px]">
        {swipes.length ? (
          <ul className="grid gap-3 sm:grid-cols-2">
            {swipes.map((s) => (
              <li key={s.id} className="flex flex-col rounded-md border border-line bg-ink px-3 py-2.5">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="truncate text-[13px] font-medium text-fg">{s.advertiser ?? "Example"}</p>
                  <span className="shrink-0 font-mono text-[10px] text-fg-faint">{s.added_by === "scout" ? "market research" : s.added_by === "agent" ? "you saved" : "Migz saved"}</span>
                </div>
                <p className="mt-1 line-clamp-3 text-[12px] text-fg-muted">{s.notes}</p>
                {s.traits && (
                  <p className="mt-2 font-mono text-[11px] text-fg-faint">
                    {[s.traits.angle, s.traits.hook_type, s.traits.compliance_risk && `${s.traits.compliance_risk} risk`].filter(Boolean).join(" · ")}
                  </p>
                )}
                <div className="mt-auto flex items-center gap-3 pt-2">
                  {s.source_url && (
                    <a href={s.source_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[11px] text-fg-muted hover:text-fg">
                      Source <ExternalLink className="size-3" />
                    </a>
                  )}
                  {s.added_by === "agent" && (
                    <button onClick={() => start(async () => { await deleteSwipe(s.id); router.refresh(); })} className="ml-auto text-fg-faint hover:text-bad" aria-label="Remove example">
                      <Trash2 className="size-3.5" />
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="Empty for now">Migz researches the market weekly. You can add ads you like too.</EmptyState>
        )}
        <form
          className="space-y-2.5"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <p className="text-[13px] font-medium text-fg">Add an ad you like</p>
          <input className={inputClass} placeholder="Link (e.g. from the Meta Ad Library)" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} />
          <input className={inputClass} placeholder="Advertiser" value={form.advertiser} onChange={(e) => setForm({ ...form, advertiser: e.target.value })} />
          <textarea className={cn(inputClass, "min-h-[88px]")} placeholder="What does it do well? The hook, the offer, the look…" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          {error && <p className="text-[12px] text-bad">{error}</p>}
          <Button type="submit" variant="primary" size="sm" disabled={pending}>Save to swipe file</Button>
        </form>
      </div>
    </Panel>
  );
}

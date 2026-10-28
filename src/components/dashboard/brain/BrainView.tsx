"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { DateTime } from "luxon";
import { ExternalLink, Trash2 } from "lucide-react";
import type { BrainLive, Scorecard } from "@/lib/migz/brain-types";
import { addSwipe, deleteSwipe } from "@/app/dashboard/actions";
import { isTopic, TOPICS } from "@/lib/migz/topics";
import { BrainGraph, BrainList } from "@/components/dashboard/brain/BrainGraph";
import { TIER } from "@/components/dashboard/brain/model";
import { PipelineStrip, SessionLog, StatusLine } from "@/components/dashboard/brain/parts";
import { LivePanel } from "@/components/dashboard/brain/LivePanel";
import { deriveGraph } from "@/components/dashboard/brain/state";
import { useBrainLive } from "@/components/dashboard/brain/useBrainLive";
import { Badge, Button, EmptyState, inputClass, Panel, PanelHeader } from "@/components/dashboard/ui";
import { cn } from "@/lib/utils";
import { ApprovalsPanel } from "@/components/dashboard/Proposals";
import type { MigzAction } from "@/lib/dashboard/queries";
import type { Phase, Thought, ThoughtStatus } from "@/lib/migz/nightly-core";

type Board = {
  findings: { check_name: string; subject: string; severity: string; summary: string; first_seen: string; status: string }[];
  experiments: { id: string; hypothesis: string; lever: string; success_metric: string; variants: { label: string; ad_id: string | null }[]; min_impressions: number; status: string; verdict: string | null; winner_label: string | null; result: { summary?: string } | null; created_at: string }[];
  learnings: { id: string; insight: string; confidence: string; source: string; created_at: string }[];
  swipes: { id: string; source_url: string | null; advertiser: string | null; notes: string | null; traits: { angle?: string; hook_type?: string; compliance_risk?: string } | null; added_by: string; created_at: string }[];
  scorecards: Scorecard[];
  notebook: { date: string; phase: Phase; headline: string; thoughts: Thought[]; sentToSlack: boolean } | null;
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

      {!demo && <LivePanel events={live.events} agentId={agentId} />}

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <Panel>
          <PanelHeader title="Session log" description="Every step Migz takes, with the numbers behind it." />
          <div className="max-h-[520px] overflow-y-auto">
            <SessionLog events={live.events} />
          </div>
        </Panel>
        <AuditPanel findings={board.findings} />
      </div>

      <NotebookPanel notebook={board.notebook} />

      <div className="grid gap-6 lg:grid-cols-2">
        <ExperimentsPanel experiments={board.experiments} />
        <LearningsPanel learnings={board.learnings} />
      </div>

      <ScorecardsPanel cards={board.scorecards} />
      <SwipePanel swipes={board.swipes} />
    </div>
  );
}

const THOUGHT_TONE: Record<ThoughtStatus, "bad" | "accent" | "neutral" | "good"> = { considering: "neutral", testing: "accent", ready: "good", done: "good", dropped: "bad" };
const THOUGHT_LABEL: Record<ThoughtStatus, string> = { considering: "considering", testing: "testing", ready: "ready to act", done: "done", dropped: "dropped" };

/** Migz's running thoughts, updated every third evening at 9pm (the same ones that go to the agent in Slack). */
function NotebookPanel({ notebook }: { notebook: Board["notebook"] }) {
  const description = !notebook
    ? "Every third evening at 9pm Migz writes up the last three days and updates the thoughts it's carrying."
    : notebook.phase === "collecting"
      ? "Migz can't change anything during the first week of a batch, so it collects thoughts and tests them against each new day."
      : "What Migz is considering, testing and ready to act on, carried from night to night.";
  return (
    <Panel>
      <PanelHeader
        title="Migz's notebook"
        description={description}
        action={notebook ? <span className="font-mono text-[11px] text-fg-faint">{DateTime.fromISO(notebook.date).toFormat("LLL d")} · {notebook.sentToSlack ? "sent to Slack" : "not sent to Slack"}</span> : undefined}
      />
      {notebook && notebook.thoughts.length ? (
        <>
          {notebook.headline && <p className="border-b border-line px-5 py-3 text-[13px] text-fg">{notebook.headline}</p>}
          <ul className="divide-y divide-line">
            {notebook.thoughts.map((t) => (
              <li key={t.id} className="flex items-start gap-3 px-5 py-3">
                <Badge tone={THOUGHT_TONE[t.status]}>{THOUGHT_LABEL[t.status]}</Badge>
                <div className="min-w-0">
                  <p className="text-[13px] text-fg">{t.text}</p>
                  {t.note && <p className="mt-0.5 text-[12px] text-fg-muted">{t.note}</p>}
                  <p className="mt-0.5 font-mono text-[11px] text-fg-faint">
                    {t.kind} · since {DateTime.fromISO(t.since).toFormat("LLL d")} · night {t.nights}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <EmptyState title={notebook ? "No open thoughts right now" : "The first summary comes at 9pm"}>
          {notebook ? "Migz has nothing it's weighing right now." : "After it, the thoughts Migz is carrying show here."}
        </EmptyState>
      )}
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

"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { Check, CheckCheck, Loader2, X } from "lucide-react";
import type { MigzAction } from "@/lib/dashboard/queries";
import { decideMigzAction } from "@/app/dashboard/actions";
import { Button, EmptyState, Panel, PanelHeader } from "@/components/dashboard/ui";

// Migz's proposals in Ask me first mode: what each one would do, with Approve and Decline.
// Shown on the Overview and in the Brain.

const KIND_LABELS: Record<string, string> = {
  launch: "Launch",
  budget: "Budget",
  creative: "Creative",
  pause: "Pause",
  audience: "Placement",
  other: "Change",
};

type Brief = {
  format?: string;
  aspect_ratio?: string;
  overlay_lines?: string[];
  hook_line?: string;
  cards?: { overlay_lines: string[]; headline: string }[];
  primary_text?: string;
  headline?: string;
};

/** What a proposal would make or change, so the agent sees the words before saying yes. */
export function ProposalPreview({ payload }: { payload: unknown }) {
  const p = (payload ?? {}) as { tool?: string; brief?: Brief; cents?: number; placements?: string[] };
  const b = p.brief;
  if (b) {
    const format =
      b.format === "carousel" ? "2-card carousel" : b.format === "image" ? (b.aspect_ratio === "9:16" ? "Stories/Reels image (9:16)" : "Feed image (4:5)") : "Reel video (9:16)";
    const onImage = b.format === "carousel" ? (b.cards ?? []).map((c) => c.overlay_lines.join(" ")) : b.format === "image" ? [(b.overlay_lines ?? []).join(" ")] : b.hook_line ? [b.hook_line] : [];
    return (
      <div className="mt-2 rounded-md border border-line bg-ink px-3 py-2 text-[12px]">
        <p className="font-mono text-[11px] uppercase tracking-wide text-fg-faint">{format}</p>
        {onImage.filter(Boolean).map((line, i) => (
          <p key={i} className="mt-1 font-medium text-fg">
            {b.format === "carousel" ? `Card ${i + 1}: ` : b.format === "image" ? "" : "Opens with: "}&ldquo;{line}&rdquo;
          </p>
        ))}
        {b.primary_text && <p className="mt-1 text-fg-muted">{b.primary_text}</p>}
        {b.headline && <p className="mt-1 text-fg-faint">Headline: {b.headline}</p>}
      </div>
    );
  }
  if (p.tool === "adjust_daily_budget" && typeof p.cents === "number")
    return <p className="mt-2 font-mono text-[12px] text-fg-faint">New daily budget: ${(p.cents / 100).toFixed(2)}</p>;
  if (p.tool === "set_placements") return <p className="mt-2 font-mono text-[12px] text-fg-faint">Placements: {p.placements?.length ? p.placements.join(", ") : "automatic"}</p>;
  return null;
}

export function Proposal({ action }: { action: MigzAction }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [choice, setChoice] = useState<"approve" | "reject" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const decide = (decision: "approve" | "reject") =>
    startTransition(async () => {
      setChoice(decision);
      setError(null);
      const res = await decideMigzAction(action.id, decision);
      if (!res.ok) {
        setError(res.error);
        setChoice(null);
      }
      router.refresh();
    });

  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, height: 0, marginTop: 0 }}
      className="rounded-lg border border-brand/25 bg-brand/[0.05] px-4 py-3"
    >
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-[13px] font-medium text-fg">{action.title}</p>
        <span className="shrink-0 text-[11px] text-fg-faint">{KIND_LABELS[action.kind] ?? action.kind}</span>
      </div>
      {action.detail && <p className="mt-0.5 text-[13px] leading-relaxed text-fg-muted">{action.detail}</p>}
      {action.payload !== undefined && <ProposalPreview payload={action.payload} />}
      {error && <p className="mt-2 text-[12px] text-bad">{error}</p>}
      <div className="mt-3 flex gap-2">
        <Button size="sm" variant="primary" onClick={() => decide("approve")} disabled={pending}>
          {pending && choice === "approve" ? <Loader2 className="animate-spin" /> : <Check />} Approve
        </Button>
        <Button size="sm" variant="ghost" onClick={() => decide("reject")} disabled={pending}>
          {pending && choice === "reject" ? <Loader2 className="animate-spin" /> : <X />} Decline
        </Button>
      </div>
    </motion.li>
  );
}

/** A wave's proposals (their briefs carry the wave's day) go together; everything else stays one by one. */
export function groupProposals(proposals: MigzAction[]) {
  const waves = new Map<number, MigzAction[]>();
  const singles: MigzAction[] = [];
  for (const p of proposals) {
    const day = (p.payload as { brief?: { wave?: unknown } } | undefined)?.brief?.wave;
    if (typeof day === "number") waves.set(day, [...(waves.get(day) ?? []), p]);
    else singles.push(p);
  }
  return { waves: [...waves].map(([day, actions]) => ({ day, actions })), singles };
}

/** One wave of new ads as a single proposal: approved or declined together, with any one ad left out. */
export function WaveProposal({ day, actions }: { day: number; actions: MigzAction[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [errors, setErrors] = useState<string[]>([]);
  const decideAll = (decision: "approve" | "reject", ids = actions.map((a) => a.id)) =>
    startTransition(async () => {
      setErrors([]);
      const failed: string[] = [];
      // One at a time: each approval re-checks against the account as the previous one left it
      for (const id of ids) {
        const res = await decideMigzAction(id, decision);
        if (!res.ok) failed.push(`${actions.find((a) => a.id === id)?.title ?? "An ad"}: ${res.error}`);
      }
      setErrors(failed);
      router.refresh();
    });
  return (
    <motion.li layout initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, height: 0, marginTop: 0 }} className="rounded-lg border border-brand/25 bg-brand/[0.05] px-4 py-3">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-[13px] font-medium text-fg">
          {actions.length} new ad{actions.length === 1 ? "" : "s"} for day {day}
        </p>
        <span className="shrink-0 text-[11px] text-fg-faint">Wave</span>
      </div>
      <p className="mt-0.5 text-[13px] leading-relaxed text-fg-muted">
        Every two weeks Migz adds a few new ads together, built from what&apos;s winning, so Meta reads them side by side. Approve them as one, or leave any out.
      </p>
      <ul className="mt-2 space-y-2">
        {actions.map((a) => (
          <li key={a.id} className="rounded-md border border-line px-3 py-2">
            <div className="flex items-baseline justify-between gap-3">
              <p className="text-[13px] text-fg">{a.title}</p>
              <button type="button" onClick={() => decideAll("reject", [a.id])} disabled={pending} className="shrink-0 text-[12px] text-fg-faint underline-offset-2 hover:text-fg hover:underline disabled:opacity-60">
                Leave out
              </button>
            </div>
            {a.detail && <p className="mt-0.5 text-[12px] leading-relaxed text-fg-muted">{a.detail}</p>}
            {a.payload !== undefined && <ProposalPreview payload={a.payload} />}
          </li>
        ))}
      </ul>
      {errors.length > 0 && (
        <div className="mt-2 text-[12px] text-bad">
          {errors.map((e) => (
            <p key={e}>{e}</p>
          ))}
        </div>
      )}
      <div className="mt-3 flex gap-2">
        <Button size="sm" variant="primary" onClick={() => decideAll("approve")} disabled={pending}>
          {pending ? <Loader2 className="animate-spin" /> : <CheckCheck />} Approve {actions.length === 1 ? "it" : `all ${actions.length}`}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => decideAll("reject")} disabled={pending}>
          <X /> Decline the wave
        </Button>
      </div>
    </motion.li>
  );
}

/** Proposals as the agent sees them: each wave as one group, then the rest one by one. */
export function ProposalList({ proposals }: { proposals: MigzAction[] }) {
  const { waves, singles } = groupProposals(proposals);
  return (
    <AnimatePresence initial={false}>
      {waves.map((w) => (
        <WaveProposal key={`wave-${w.day}`} day={w.day} actions={w.actions} />
      ))}
      {singles.map((p) => (
        <Proposal key={p.id} action={p} />
      ))}
    </AnimatePresence>
  );
}

/** The Brain's approvals panel (Ask me first mode): everything waiting, with Approve all. */
export function ApprovalsPanel({ proposals }: { proposals: MigzAction[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [errors, setErrors] = useState<string[]>([]);

  const approveAll = () =>
    startTransition(async () => {
      setErrors([]);
      const failed: string[] = [];
      // One at a time: each approval re-checks against the account as the previous one left it
      for (const p of proposals) {
        const res = await decideMigzAction(p.id, "approve");
        if (!res.ok) failed.push(`${p.title}: ${res.error}`);
      }
      setErrors(failed);
      router.refresh();
    });

  return (
    <Panel id="approvals" className="scroll-mt-32 lg:scroll-mt-20">
      <PanelHeader
        title="Waiting for your OK"
        description="Ask me first is on, so nothing below happens until you approve it. Proposals expire after 48 hours."
        action={
          proposals.length > 1 ? (
            <Button size="sm" variant="primary" onClick={approveAll} disabled={pending}>
              {pending ? <Loader2 className="animate-spin" /> : <CheckCheck />} Approve all {proposals.length}
            </Button>
          ) : undefined
        }
      />
      {proposals.length ? (
        <ul className="space-y-2 px-5 py-4">
          <ProposalList proposals={proposals} />
        </ul>
      ) : (
        <EmptyState title="Nothing waiting">When Migz proposes a new ad or a change, it shows up here.</EmptyState>
      )}
      {errors.length > 0 && (
        <div className="border-t border-line px-5 py-3 text-[12px] text-bad">
          {errors.map((e) => (
            <p key={e}>{e}</p>
          ))}
        </div>
      )}
    </Panel>
  );
}

"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { DateTime } from "luxon";
import { ArrowRight, Loader2 } from "lucide-react";
import type { MigzAction } from "@/lib/dashboard/queries";
import { runMigzNow } from "@/app/dashboard/actions";
import { Proposal } from "@/components/dashboard/Proposals";
import { MigzStatus } from "@/components/dashboard/Migz";
import { Badge, Button, EmptyState } from "@/components/dashboard/ui";

const KIND_LABELS: Record<string, string> = {
  launch: "Launch",
  budget: "Budget",
  creative: "Creative",
  pause: "Paused",
  audience: "Placement",
  other: "Change",
};

const MODE_LABELS = { off: "Off", approve: "Asks you first", auto: "Automatic" } as const;

function OutcomeBadge({ action }: { action: MigzAction }) {
  if (action.status === "failed") return <Badge tone="bad">Didn&apos;t go through</Badge>;
  if (action.status === "rejected") return <Badge>You declined</Badge>;
  if (action.status === "expired") return <Badge>Expired</Badge>;
  return null;
}

export function MigzPanel({
  connected,
  mode,
  recentlyRan,
  proposals,
  actions,
}: {
  connected: boolean;
  mode: "off" | "approve" | "auto";
  recentlyRan: boolean; // a full review finished within the last 10 minutes (computed on the server)
  proposals: MigzAction[];
  actions: MigzAction[];
}) {
  const router = useRouter();
  const [reviewing, startReview] = useTransition();
  const [note, setNote] = useState<{ tone: "good" | "bad"; text: string } | null>(null);

  const review = () =>
    startReview(async () => {
      setNote(null);
      const res = await runMigzNow();
      if (!res.ok) {
        setNote({ tone: "bad", text: res.error });
        return;
      }
      // The review runs in the background; the Brain page shows it step by step
      router.push("/dashboard/brain?started=1");
    });

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
        <MigzStatus connected={connected && mode !== "off"} />
        {connected && (
          <div className="flex items-center gap-2">
            <Link href="/dashboard/settings" className="text-[12px] text-fg-faint transition-colors hover:text-fg">
              {MODE_LABELS[mode]}
            </Link>
            {mode !== "off" && (
              <Button size="sm" onClick={review} disabled={reviewing || recentlyRan} title={recentlyRan ? "Migz just finished a review. Try again in a few minutes." : undefined}>
                {reviewing ? <Loader2 className="animate-spin" /> : null}
                {reviewing ? "Starting…" : "Review now"}
              </Button>
            )}
          </div>
        )}
      </div>

      <AnimatePresence>
        {note && (
          <motion.p
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className={`overflow-hidden border-b border-line px-5 py-3 text-[13px] ${note.tone === "good" ? "text-fg-muted" : "text-bad"}`}
          >
            {note.text}
          </motion.p>
        )}
      </AnimatePresence>

      {proposals.length > 0 && (
        <div className="border-b border-line px-5 py-4">
          <p className="mb-3 text-[11px] font-medium uppercase tracking-wide text-fg-faint">
            Waiting for your OK · {proposals.length}
          </p>
          <ul className="space-y-2">
            <AnimatePresence initial={false}>
              {proposals.map((p) => (
                <Proposal key={p.id} action={p} />
              ))}
            </AnimatePresence>
          </ul>
        </div>
      )}

      <p className="px-5 pt-4 text-[11px] font-medium uppercase tracking-wide text-fg-faint">What Migz changed, and why</p>
      {actions.length ? (
        <ol className="relative px-5 pb-4 pt-3">
          <span className="absolute bottom-6 left-[23px] top-5 w-px bg-line" aria-hidden="true" />
          {actions.map((a) => (
            <li key={a.id} className="relative pb-5 pl-6 last:pb-0">
              <span
                className={`absolute left-[-1px] top-1.5 size-[7px] rounded-full border border-ink-raised ${a.status === "applied" ? "bg-brand" : "bg-fg-faint"}`}
              />
              <div className="flex items-baseline justify-between gap-3">
                <p className={`text-[13px] font-medium ${a.status === "applied" ? "text-fg" : "text-fg-muted"}`}>{a.title}</p>
                <span className="shrink-0 text-[11px] text-fg-faint">
                  {DateTime.fromISO(a.created_at).toRelative({ style: "short" })}
                </span>
              </div>
              {a.detail && <p className="mt-0.5 text-[13px] leading-relaxed text-fg-muted">{a.detail}</p>}
              {a.status === "failed" && a.result?.error && (
                <p className="mt-0.5 text-[12px] text-bad">{a.result.error}</p>
              )}
              <div className="mt-1 flex items-center gap-2">
                <span className="text-[11px] uppercase tracking-wide text-fg-faint">{KIND_LABELS[a.kind] ?? a.kind}</span>
                <OutcomeBadge action={a} />
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <EmptyState title="No changes yet">
          Migz checks your results several times a day and logs every change it makes to your campaigns here, with the
          reason.
        </EmptyState>
      )}

      <Link
        href="/dashboard/creatives"
        className="flex items-center justify-between gap-3 border-t border-line px-5 py-3 text-[13px] text-fg-muted transition-colors hover:bg-white/[0.03] hover:text-fg"
      >
        <span>The better your videos, the better Migz can do. Add creatives</span>
        <ArrowRight className="size-3.5 shrink-0" />
      </Link>
    </>
  );
}

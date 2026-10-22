"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { Plus, X } from "lucide-react";
import { startBatch } from "@/app/dashboard/actions";
import { BatchPlanner } from "@/components/dashboard/batch/BatchPlanner";
import { Button } from "@/components/dashboard/ui";

/** "Start campaign batch": a dialog with the batch planner; starting one opens the Brain to watch Migz set it up. */
export function StartBatchButton({ balanceCents, disabledReason }: { balanceCents: number; disabledReason: string | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <Button variant="primary" onClick={() => setOpen(true)} disabled={!!disabledReason} title={disabledReason ?? undefined}>
        <Plus /> Start campaign batch
      </Button>
      <AnimatePresence>
        {open && (
          <motion.div
            className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 px-4 py-10 sm:py-16"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setOpen(false)}
          >
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-labelledby="start-batch-title"
              initial={{ opacity: 0, y: 12, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.98 }}
              transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-2xl rounded-xl border border-line-strong bg-ink-raised shadow-2xl"
            >
              <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
                <div>
                  <h2 id="start-batch-title" className="text-sm font-semibold text-fg">Start a campaign batch</h2>
                  <p className="mt-0.5 text-[13px] text-fg-muted">
                    Tell Migz how much to put in. It lays out how it would spend it, and recommends one plan for you.
                  </p>
                </div>
                <button type="button" aria-label="Close" onClick={() => setOpen(false)} className="rounded-md p-1 text-fg-faint hover:bg-white/[0.05] hover:text-fg">
                  <X className="size-4" />
                </button>
              </div>
              <div className="px-5 py-5">
                <BatchPlanner
                  balanceCents={balanceCents}
                  confirmLabel="Start batch"
                  onConfirm={async (choice) => {
                    const res = await startBatch(choice);
                    if (res.ok) {
                      setOpen(false);
                      router.push("/dashboard/brain?started=1");
                    }
                    return res;
                  }}
                />
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

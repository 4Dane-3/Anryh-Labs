"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { Plus, X } from "lucide-react";
import { startBatch } from "@/app/dashboard/actions";
import { CampaignFlow, type CampaignStart } from "@/components/dashboard/start/CampaignFlow";
import { Button } from "@/components/dashboard/ui";
import type { OwnNumbers } from "@/lib/campaign-plan";

/** "Start campaign": the start flow in a dialog; starting one opens the Brain to watch Migz set it up. */
export function StartBatchButton({ balanceCents, disabledReason, start, own }: { balanceCents: number; disabledReason: string | null; start: CampaignStart; own: OwnNumbers | null }) {
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
        <Plus /> Start campaign
      </Button>
      <AnimatePresence>
        {open && (
          <motion.div
            className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 px-3 py-6 sm:px-4 sm:py-16"
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
              className="w-full max-w-2xl rounded-2xl border border-line-strong bg-ink/95 shadow-2xl backdrop-blur-2xl"
            >
              <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
                <div>
                  <h2 id="start-batch-title" className="text-sm font-semibold text-fg">Start a campaign</h2>
                  <p className="mt-0.5 text-[13px] text-fg-muted">A few quick questions, filled in from your last campaign. Change what&apos;s different.</p>
                </div>
                <button type="button" aria-label="Close" onClick={() => setOpen(false)} className="rounded-md p-1 text-fg-faint hover:bg-white/[0.05] hover:text-fg">
                  <X className="size-4" />
                </button>
              </div>
              <div className="px-5 py-5">
                <CampaignFlow
                  initial={start}
                  balanceCents={balanceCents}
                  own={own}
                  confirmLabel="Start campaign"
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

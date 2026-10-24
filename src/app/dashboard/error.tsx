"use client";

import { useEffect } from "react";
import { friendlyActionError } from "@/lib/dashboard/action-errors";

// Replaces a blank "application error" when something in the dashboard throws. The usual cause is a page
// that was open while Migz was updated, which a reload fixes.
export default function DashboardError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("dashboard error", error.message, error.digest ?? "");
  }, [error]);
  return (
    <div className="mx-auto mt-24 max-w-md rounded-xl border border-line bg-ink-raised px-6 py-8 text-center">
      <h1 className="text-lg font-semibold text-fg">This page hit a snag</h1>
      <p className="mt-2 text-[13px] text-fg-muted">{friendlyActionError(error)}</p>
      <div className="mt-5 flex justify-center gap-2">
        <button type="button" onClick={() => window.location.reload()} className="rounded-md bg-brand px-3 py-1.5 text-[13px] font-semibold text-brand-fg hover:bg-brand/90">
          Reload
        </button>
        <button type="button" onClick={reset} className="rounded-md border border-line px-3 py-1.5 text-[13px] text-fg-muted hover:text-fg">
          Try again
        </button>
      </div>
    </div>
  );
}

"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { decideBookingGuarantee } from "@/app/admin/actions";
import { Button, Panel, PanelHeader } from "@/components/dashboard/ui";

// Missed booked-call guarantees waiting on staff: approve credits the agent's Anryh Labs fee back to their ad
// balance (once), decline closes it. Hidden when nothing is waiting.

export type GuaranteeReview = { id: string; name: string; slug: string; startsOn: string; endsOn: string; bookings: number; target: number; feeCents: number };

export function GuaranteeReviews({ items }: { items: GuaranteeReview[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [note, setNote] = useState<string | null>(null);
  if (!items.length) return null;
  const decide = (id: string, approve: boolean) =>
    start(async () => {
      setNote(null);
      const res = await decideBookingGuarantee(id, approve);
      setNote(res.ok ? (res.message ?? "Done.") : res.error);
      router.refresh();
    });
  return (
    <Panel>
      <PanelHeader title="Booked-call guarantees to review" description="These agents met every condition and still ended under target. Approving credits their Anryh Labs fee back to their ad balance." />
      <ul className="divide-y divide-line">
        {items.map((g) => (
          <li key={g.id} className="flex flex-wrap items-center gap-4 px-5 py-3 text-sm">
            <div className="min-w-0 flex-1">
              <p className="font-medium text-fg">{g.name}</p>
              <p className="text-[12px] text-fg-muted">
                {g.startsOn} to {g.endsOn} · {g.bookings} of {g.target} booked calls · fee ${(g.feeCents / 100).toFixed(2)}
              </p>
            </div>
            <Button size="sm" variant="primary" disabled={pending} onClick={() => decide(g.id, true)}>
              Approve refund
            </Button>
            <Button size="sm" variant="ghost" disabled={pending} onClick={() => decide(g.id, false)}>
              Decline
            </Button>
          </li>
        ))}
      </ul>
      {note && <p className="border-t border-line px-5 py-3 text-[13px] text-fg-muted">{note}</p>}
    </Panel>
  );
}

"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { decideGoogleAction } from "@/app/dashboard/google/actions";
import { Button } from "@/components/dashboard/ui";

/** Google Ads changes Migz proposed, for an ask-first roofer to approve or decline. */
export function GoogleProposals({ items }: { items: { id: string; title: string; reason: string }[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [notes, setNotes] = useState<Record<string, { good: boolean; text: string }>>({});
  const decide = (id: string, approve: boolean) =>
    start(async () => {
      const r = await decideGoogleAction(id, approve);
      setNotes((n) => ({ ...n, [id]: r.ok ? { good: true, text: r.message } : { good: false, text: r.error } }));
      router.refresh();
    });
  return (
    <ul className="divide-y divide-line">
      {items.map((p) => (
        <li key={p.id} className="flex flex-wrap items-start justify-between gap-3 px-5 py-4">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-fg">{p.title}</p>
            {p.reason && <p className="mt-0.5 text-[13px] text-fg-muted">{p.reason}</p>}
            {notes[p.id] && <p className={`mt-1 text-[12px] ${notes[p.id].good ? "text-good" : "text-brand"}`}>{notes[p.id].text}</p>}
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="primary" disabled={pending} onClick={() => decide(p.id, true)}>
              Approve
            </Button>
            <Button size="sm" variant="ghost" disabled={pending} onClick={() => decide(p.id, false)}>
              Decline
            </Button>
          </div>
        </li>
      ))}
    </ul>
  );
}

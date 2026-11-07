"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { markOutcome } from "@/app/admin/crm/actions";
import { NEXT_STEPS, type MeetingOutcome, type NextStep } from "@/lib/crm/types";
import { Button } from "@/components/dashboard/ui";
import { Modal } from "@/components/admin/crm/shared";
import { cn } from "@/lib/utils";

const OUTCOMES: { value: MeetingOutcome; label: string; hint: string }[] = [
  { value: "showed", label: "Showed", hint: "Pick the next step and it goes on your task list." },
  { value: "no_show", label: "No-show", hint: "They get an email with a link to pick another time, and a call task goes on today's list." },
  { value: "rescheduled", label: "Rescheduled", hint: "You moved it. Schedule the new time from their page." },
];
const CHECK_INS = [2, 5, 10];

/** After a meeting starts: showed, no-show or rescheduled, and for "showed" the next step. */
export function OutcomeDialog({ meetingId, label, open, onClose }: { meetingId: string; label: string; open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} title={`What happened with ${label}?`}>
      {open && <Form meetingId={meetingId} onClose={onClose} />}
    </Modal>
  );
}

function Form({ meetingId, onClose }: { meetingId: string; onClose: () => void }) {
  const router = useRouter();
  const [outcome, setOutcome] = useState<MeetingOutcome | null>(null);
  const [step, setStep] = useState<NextStep | null>(null);
  const [checkIns, setCheckIns] = useState<number[]>(CHECK_INS);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (done)
    return (
      <div className="space-y-4">
        <p className="text-[13px] text-fg">{done}</p>
        <div className="flex justify-end">
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    );

  const option = (selected: boolean) => cn("w-full rounded-lg border px-3 py-2.5 text-left text-[13px] transition", selected ? "border-brand/60 bg-brand/10 text-fg" : "border-line text-fg-muted hover:border-line-strong hover:text-fg");

  return (
    <div className="space-y-4">
      <div className="space-y-2" role="radiogroup" aria-label="What happened">
        {OUTCOMES.map((o) => (
          <button key={o.value} type="button" role="radio" aria-checked={outcome === o.value} onClick={() => setOutcome(o.value)} className={option(outcome === o.value)}>
            <span className="font-medium text-fg">{o.label}</span>
            <span className="mt-0.5 block text-[12px] text-fg-muted">{o.hint}</span>
          </button>
        ))}
      </div>

      {outcome === "showed" && (
        <div>
          <p className="mb-2 text-[12px] font-medium text-fg-muted">Next step</p>
          <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Next step">
            {(Object.keys(NEXT_STEPS) as NextStep[]).map((k) => (
              <button key={k} type="button" role="radio" aria-checked={step === k} onClick={() => setStep(k)} className={option(step === k)}>
                {NEXT_STEPS[k]}
              </button>
            ))}
          </div>
          {step === "follow_up" && (
            <fieldset className="mt-3 rounded-lg border border-line px-3 py-2.5">
              <legend className="px-1 text-[12px] text-fg-muted">Also add check-in tasks (you send these yourself)</legend>
              <div className="flex gap-4">
                {CHECK_INS.map((d) => (
                  <label key={d} className="flex items-center gap-1.5 text-[13px] text-fg">
                    <input
                      type="checkbox"
                      checked={checkIns.includes(d)}
                      onChange={(e) => setCheckIns(e.target.checked ? [...checkIns, d] : checkIns.filter((x) => x !== d))}
                      className="size-3.5 accent-[var(--color-brand)]"
                    />
                    In {d} days
                  </label>
                ))}
              </div>
            </fieldset>
          )}
        </div>
      )}

      {error && <p className="text-[13px] text-bad">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant="primary"
          disabled={pending || !outcome || (outcome === "showed" && !step)}
          onClick={() =>
            start(async () => {
              setError(null);
              const r = await markOutcome({ meetingId, outcome: outcome!, nextStep: step ?? undefined, checkIns: step === "follow_up" ? checkIns : [] });
              if (!r.ok) return setError(r.error);
              setDone(r.message ?? "Saved.");
              router.refresh();
            })
          }
        >
          {pending ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  );
}

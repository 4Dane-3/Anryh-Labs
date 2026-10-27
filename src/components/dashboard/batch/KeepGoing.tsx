"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Repeat } from "lucide-react";
import { setBatchRenew } from "@/app/dashboard/actions";
import { cn } from "@/lib/utils";

/**
 * "Keep going": a switch on the running batch. On, the same batch starts again when it ends, paid from the
 * free ad balance (never a card). Off, the batch just ends. The note says what happens next and, when the
 * balance wouldn't cover it, what's missing.
 */
export function KeepGoing({ on, note, warn }: { on: boolean; note: string; warn?: boolean }) {
  const router = useRouter();
  const [value, setValue] = useState(on);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const toggle = () =>
    start(async () => {
      setError(null);
      const next = !value;
      setValue(next);
      const res = await setBatchRenew(next);
      if (!res.ok) {
        setValue(!next);
        return setError(res.error);
      }
      router.refresh();
    });

  return (
    <div className="border-t border-line pt-3">
      <div className="flex items-center justify-between gap-3">
        <p className="flex items-center gap-1.5 text-[13px] font-medium text-fg">
          <Repeat className="size-3.5 text-brand" /> Keep going
        </p>
        <button
          type="button"
          role="switch"
          aria-checked={value}
          aria-label="Keep going: start the same batch again when this one ends"
          disabled={pending}
          onClick={toggle}
          className={cn("relative h-5 w-9 shrink-0 rounded-full transition-colors disabled:opacity-60", value ? "bg-brand" : "bg-white/[0.12]")}
        >
          <span className={cn("absolute top-0.5 size-4 rounded-full bg-white transition-[left]", value ? "left-[18px]" : "left-0.5")} />
        </button>
      </div>
      <p className={cn("mt-1.5 text-[12px] leading-snug", warn && value ? "text-brand" : "text-fg-faint")}>{note}</p>
      {error && <p className="mt-1 text-[12px] text-bad">{error}</p>}
    </div>
  );
}

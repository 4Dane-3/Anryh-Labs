"use client";

import { useFormStatus } from "react-dom";

/** A form button that shows it's working, so a slow connection doesn't look like nothing happened. */
export function SubmitButton({ className, pendingLabel, children }: { className: string; pendingLabel: string; children: React.ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <button disabled={pending} className={`${className} disabled:opacity-60`}>
      {pending ? pendingLabel : children}
    </button>
  );
}

"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { Loader2, X } from "lucide-react";
import { addClient } from "@/app/dashboard/actions";
import { Button, inputClass } from "@/components/dashboard/ui";
import { cn } from "@/lib/utils";

// Add a personal client: someone who reached the agent outside Migz (called them directly, a referral, a past
// client), so everyone they work with is in one list. Personal clients are never sent to Meta, emailed by
// Migz or counted in the ads' results.

const FOUND_VIA = ["Called me directly", "Referral", "Past client", "Met in person", "Social media"];
const COVERAGE = ["Final expense", "Whole life", "Term life", "Mortgage protection", "Not sure yet"];

const EMPTY = { name: "", phone: "", email: "", foundVia: FOUND_VIA[0], coverage: "", status: "prospect" as "prospect" | "current", notes: "" };

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-[13px] font-medium text-fg">
        {label} {hint && <span className="font-normal text-fg-faint">{hint}</span>}
      </span>
      {children}
    </label>
  );
}

export function AddClient({ open, onClose, onAdded }: { open: boolean; onClose: () => void; onAdded: (key: string) => void }) {
  const router = useRouter();
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const set = <K extends keyof typeof EMPTY>(k: K, v: (typeof EMPTY)[K]) => setForm((f) => ({ ...f, [k]: v }));

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await addClient(form);
      if (!res.ok) return setError(res.error);
      setForm(EMPTY);
      router.refresh();
      onAdded(res.key);
    });
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div key="scrim" className="fixed inset-0 z-40 bg-black/50" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
          <motion.aside
            key="add-client"
            role="dialog"
            aria-label="Add a client"
            className="fixed inset-y-0 right-0 z-50 flex w-full max-w-lg flex-col border-l border-line bg-ink shadow-2xl"
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", stiffness: 380, damping: 40 }}
          >
            <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
              <div className="flex items-start justify-between gap-4 border-b border-line px-6 py-5">
                <div>
                  <h2 className="text-lg font-semibold">Add a client</h2>
                  <p className="mt-0.5 text-[13px] text-fg-muted">Someone who reached you outside Migz, like a direct call or a referral. They&apos;re listed as Personal, and Migz never emails them or tells Meta about them.</p>
                </div>
                <button type="button" onClick={onClose} aria-label="Close" className="rounded-md p-1.5 text-fg-muted transition-colors hover:bg-white/[0.06] hover:text-fg">
                  <X className="size-5" />
                </button>
              </div>

              <div className="flex-1 space-y-5 overflow-y-auto px-6 py-6">
                <Field label="Name">
                  <input className={inputClass} value={form.name} onChange={(e) => set("name", e.target.value)} autoComplete="off" required autoFocus />
                </Field>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Phone">
                    <input className={inputClass} type="tel" inputMode="tel" placeholder="(312) 555-0100" value={form.phone} onChange={(e) => set("phone", e.target.value)} autoComplete="off" required />
                  </Field>
                  <Field label="Email" hint="optional">
                    <input className={inputClass} type="email" value={form.email} onChange={(e) => set("email", e.target.value)} autoComplete="off" />
                  </Field>
                </div>
                <Field label="How they found you">
                  <input className={inputClass} list="found-via" value={form.foundVia} onChange={(e) => set("foundVia", e.target.value)} maxLength={120} />
                  <datalist id="found-via">
                    {FOUND_VIA.map((v) => (
                      <option key={v} value={v} />
                    ))}
                  </datalist>
                </Field>
                <Field label="Interested in" hint="optional">
                  <input className={inputClass} list="coverage" value={form.coverage} onChange={(e) => set("coverage", e.target.value)} maxLength={80} />
                  <datalist id="coverage">
                    {COVERAGE.map((v) => (
                      <option key={v} value={v} />
                    ))}
                  </datalist>
                </Field>
                <div className="space-y-1.5">
                  <span className="text-[13px] font-medium text-fg">Status</span>
                  <div role="radiogroup" aria-label="Status" className="grid grid-cols-2 gap-1 rounded-lg bg-white/[0.04] p-1">
                    {(
                      [
                        ["prospect", "Prospect"],
                        ["current", "Current plan"],
                      ] as const
                    ).map(([key, label]) => (
                      <button
                        key={key}
                        type="button"
                        role="radio"
                        aria-checked={form.status === key}
                        onClick={() => set("status", key)}
                        className={cn(
                          "h-8 rounded-md text-[13px] font-medium transition-colors",
                          form.status === key ? (key === "current" ? "bg-good/15 text-good" : "bg-brand/15 text-brand") : "text-fg-muted hover:text-fg",
                        )}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                <Field label="Notes" hint="optional">
                  <textarea className={cn(inputClass, "min-h-24 resize-y")} value={form.notes} onChange={(e) => set("notes", e.target.value)} maxLength={5000} />
                </Field>
              </div>

              <div className="flex items-center justify-end gap-3 border-t border-line px-6 py-4">
                {error && <p className="mr-auto text-[13px] text-bad">{error}</p>}
                <Button type="button" variant="ghost" onClick={onClose}>
                  Cancel
                </Button>
                <Button type="submit" variant="primary" disabled={pending}>
                  {pending && <Loader2 className="animate-spin" />}
                  Add client
                </Button>
              </div>
            </form>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

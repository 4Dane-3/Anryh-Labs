"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { DateTime } from "luxon";
import { Check, Copy, Mail, Phone, X } from "lucide-react";
import type { ClientBooking } from "@/lib/dashboard/queries";
import { phone as formatPhone } from "@/lib/dashboard/format";
import { orderedAnswers } from "@/lib/booking/questions";
import { cancelBooking, saveBookingNotes } from "@/app/dashboard/actions";
import { Badge, Button, inputClass } from "@/components/dashboard/ui";

function sourceOf(attribution: Record<string, string>) {
  const src = (attribution.utm_source ?? "").toLowerCase();
  if (attribution.fbclid || ["facebook", "fb", "instagram", "ig", "meta"].includes(src)) {
    return ["Meta ad", attribution.utm_campaign].filter(Boolean).join(" · ");
  }
  if (src) return [attribution.utm_source, attribution.utm_campaign].filter(Boolean).join(" · ");
  return "Direct visit to your page";
}

export function statusBadge(b: ClientBooking) {
  if (b.status === "cancelled") return <Badge tone="bad">Cancelled</Badge>;
  if (new Date(b.ends_at) < new Date()) return <Badge>Past</Badge>;
  return <Badge tone="accent">Upcoming</Badge>;
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      aria-label={`Copy ${label}`}
      onClick={async () => {
        await navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      }}
      className="rounded-md p-1.5 text-fg-faint transition-colors hover:bg-white/[0.06] hover:text-fg"
    >
      {copied ? <Check className="size-3.5 text-good" /> : <Copy className="size-3.5" />}
    </button>
  );
}

function DrawerBody({
  booking,
  timezone,
  questionOrder,
  onClose,
}: {
  booking: ClientBooking;
  timezone: string;
  questionOrder: string[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [notes, setNotes] = useState(booking.agent_notes ?? "");
  const [saved, setSaved] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const start = DateTime.fromISO(booking.starts_at, { zone: timezone });
  const answers = booking.answers ? orderedAnswers(booking.answers, questionOrder) : [];
  const upcoming = booking.status === "confirmed" && new Date(booking.ends_at) > new Date();

  const save = () =>
    startTransition(async () => {
      const res = await saveBookingNotes(booking.id, notes);
      if (!res.ok) return setError(res.error);
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
      router.refresh();
    });

  const cancel = () =>
    startTransition(async () => {
      const res = await cancelBooking(booking.id);
      if (!res.ok) return setError(res.error);
      router.refresh();
      onClose();
    });

  return (
    <>
      <div className="flex items-start justify-between gap-4 border-b border-line px-6 py-5">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="truncate text-lg font-semibold">{booking.name}</h2>
            {statusBadge(booking)}
          </div>
          <p className="mt-1 text-[13px] text-fg-muted">
            {start.toFormat("cccc, LLL d 'at' h:mm a ZZZZ")}
            <span className="text-fg-faint"> · {start.toRelative()}</span>
          </p>
        </div>
        <button
          onClick={onClose}
          aria-label="Close"
          className="rounded-md p-1.5 text-fg-muted transition-colors hover:bg-white/[0.06] hover:text-fg"
        >
          <X className="size-5" />
        </button>
      </div>

      <div className="flex-1 space-y-7 overflow-y-auto px-6 py-6">
        <section className="space-y-1">
          <div className="flex items-center gap-3 rounded-lg px-2 py-1.5 -mx-2 hover:bg-white/[0.03]">
            <Phone className="size-4 text-fg-faint" />
            <a href={`tel:${booking.phone}`} className="flex-1 text-sm hover:text-brand">
              {formatPhone(booking.phone)}
            </a>
            <CopyButton value={booking.phone} label="phone number" />
          </div>
          <div className="flex items-center gap-3 rounded-lg px-2 py-1.5 -mx-2 hover:bg-white/[0.03]">
            <Mail className="size-4 text-fg-faint" />
            <a href={`mailto:${booking.email}`} className="flex-1 truncate text-sm hover:text-brand">
              {booking.email}
            </a>
            <CopyButton value={booking.email} label="email" />
          </div>
        </section>

        <section>
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-faint">Prep answers</h3>
            {booking.intake_completed ? (
              <Badge tone="good">Finished</Badge>
            ) : answers.length ? (
              <Badge tone="accent">Partly answered</Badge>
            ) : null}
          </div>
          {answers.length ? (
            <dl className="divide-y divide-line rounded-lg border border-line">
              {answers.map(([key, a]) => (
                <div key={key} className="px-4 py-3">
                  <dt className="text-[12px] text-fg-muted">{a.label}</dt>
                  <dd className="mt-0.5 whitespace-pre-wrap text-sm text-fg">{a.value}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="text-[13px] text-fg-muted">They haven&apos;t answered the prep questions yet.</p>
          )}
        </section>

        <section>
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-fg-faint">Your notes</h3>
          <textarea
            rows={4}
            className={inputClass}
            placeholder="Only you can see these."
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
          <div className="mt-2 flex items-center gap-3">
            <Button size="sm" onClick={save} disabled={pending || notes === (booking.agent_notes ?? "")}>
              Save notes
            </Button>
            <AnimatePresence>
              {saved && (
                <motion.span
                  initial={{ opacity: 0, x: -4 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0 }}
                  className="text-[13px] text-good"
                >
                  Saved
                </motion.span>
              )}
            </AnimatePresence>
          </div>
        </section>

        <section className="grid grid-cols-2 gap-4 text-[13px]">
          <div>
            <p className="text-fg-faint">Came from</p>
            <p className="mt-0.5 text-fg">{sourceOf(booking.attribution ?? {})}</p>
          </div>
          <div>
            <p className="text-fg-faint">Booked</p>
            <p className="mt-0.5 text-fg">
              {DateTime.fromISO(booking.created_at, { zone: timezone }).toFormat("LLL d, h:mm a")}
            </p>
          </div>
        </section>

        {error && <p className="text-[13px] text-bad">{error}</p>}
      </div>

      {upcoming && (
        <div className="border-t border-line px-6 py-4">
          <AnimatePresence mode="wait" initial={false}>
            {confirmCancel ? (
              <motion.div
                key="confirm"
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="space-y-3"
              >
                <p className="text-[13px] text-fg-muted">
                  Cancel this call? The time opens up again on your page.{" "}
                  <span className="text-fg">{booking.name.split(" ")[0]} won&apos;t be notified automatically</span>, so let them
                  know yourself.
                </p>
                <div className="flex gap-2">
                  <Button size="sm" variant="ghost" onClick={() => setConfirmCancel(false)}>
                    Keep it
                  </Button>
                  <Button size="sm" variant="danger" onClick={cancel} disabled={pending}>
                    Cancel call
                  </Button>
                </div>
              </motion.div>
            ) : (
              <motion.div key="idle" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <Button size="sm" variant="danger" className="-ml-3" onClick={() => setConfirmCancel(true)}>
                  Cancel this call
                </Button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
    </>
  );
}

export function ClientDrawer({
  booking,
  timezone,
  questionOrder,
  onClose,
}: {
  booking: ClientBooking | null;
  timezone: string;
  questionOrder: string[];
  onClose: () => void;
}) {
  useEffect(() => {
    if (!booking) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [booking, onClose]);

  return (
    <AnimatePresence>
      {booking && (
        <>
          <motion.div
            key="scrim"
            className="fixed inset-0 z-40 bg-black/50"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.aside
            key={booking.id}
            role="dialog"
            aria-label={`${booking.name} details`}
            className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l border-line bg-ink shadow-2xl"
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", stiffness: 380, damping: 40 }}
          >
            <DrawerBody booking={booking} timezone={timezone} questionOrder={questionOrder} onClose={onClose} />
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

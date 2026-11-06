"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { Badge } from "@/components/dashboard/ui";
import { STATUS_LABEL, type ClientStatus, type CrmColumn, type CustomValue, type MeetingStatus, type OptionColor } from "@/lib/crm/types";
import { cn } from "@/lib/utils";

export const STATUS_TONE: Record<ClientStatus, OptionColor> = { lead: "neutral", contacted: "neutral", meeting: "accent", client: "good", lost: "bad" };

export function StatusBadge({ status }: { status: ClientStatus }) {
  return <Badge tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Badge>;
}

export const MEETING_LABEL: Record<MeetingStatus, string> = { draft: "Draft", invited: "Invited", confirmed: "Confirmed", cancelled: "Cancelled" };
export const MEETING_TONE: Record<MeetingStatus, OptionColor> = { draft: "neutral", invited: "accent", confirmed: "good", cancelled: "bad" };

export function MeetingBadge({ status }: { status: MeetingStatus }) {
  return <Badge tone={MEETING_TONE[status]}>{MEETING_LABEL[status]}</Badge>;
}

/** Dot colour classes per tone, for calendar chips. */
export const TONE_DOT: Record<OptionColor, string> = { neutral: "bg-fg-faint", accent: "bg-brand", good: "bg-good", bad: "bg-bad" };

export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 px-4 py-10 backdrop-blur-sm [color-scheme:dark]" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label={title} className={cn("w-full rounded-2xl border border-line bg-[#26282a] text-fg shadow-2xl", wide ? "max-w-3xl" : "max-w-lg")}>
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <h2 className="text-sm font-semibold">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="rounded-md p-1 text-fg-faint hover:bg-white/[0.06] hover:text-fg">
            <X className="size-4" />
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

/** A custom column's value, read-only. */
export function CustomValueView({ column, value }: { column: CrmColumn; value: CustomValue | undefined }) {
  if (value === undefined || value === null || value === "") return <span className="text-fg-faint">—</span>;
  if (column.type === "checkbox") return <span>{value ? "Yes" : "No"}</span>;
  if (column.type === "select") {
    const opt = column.options.find((o) => o.value === value);
    return <Badge tone={opt?.color ?? "neutral"}>{String(value)}</Badge>;
  }
  return <span>{String(value)}</span>;
}

export const selectClass =
  "rounded-md border border-transparent bg-transparent px-1.5 py-1 text-[13px] text-fg hover:border-line focus:border-brand/60 focus:outline-none [&>option]:bg-[#26282a]";

export const TIMEZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Phoenix",
  "America/Los_Angeles",
  "America/Anchorage",
  "Pacific/Honolulu",
  "America/Puerto_Rico",
  "Europe/London",
  "Europe/Paris",
  "Asia/Manila",
  "Australia/Sydney",
  "UTC",
];

"use client";

import { useState, useTransition } from "react";
import { setClientField } from "@/app/admin/crm/actions";
import type { CrmColumn, CustomValue } from "@/lib/crm/types";
import { selectClass } from "@/components/admin/crm/shared";
import { cn } from "@/lib/utils";

const TONE_TEXT = { neutral: "text-fg", accent: "text-brand", good: "text-good", bad: "text-bad" } as const;

/** Edits one client's value for one custom column in place, and saves it right away. */
export function CustomCell({ clientId, column, value, onSaved }: { clientId: string; column: CrmColumn; value: CustomValue | undefined; onSaved?: (v: CustomValue) => void }) {
  const [v, setV] = useState<CustomValue>(value ?? null);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // A fresh value from the server (after a refresh) replaces the local one
  const [seen, setSeen] = useState(value);
  if (seen !== value) {
    setSeen(value);
    setV(value ?? null);
  }

  const save = (next: CustomValue) => {
    const prev = v;
    setV(next);
    setError(null);
    start(async () => {
      const r = await setClientField(clientId, column.id, next);
      if (r.ok) onSaved?.(next);
      else {
        setV(prev);
        setError(r.error);
      }
    });
  };

  const common = cn("w-full min-w-0", pending && "opacity-60");
  let input: React.ReactNode;
  switch (column.type) {
    case "checkbox":
      input = <input type="checkbox" aria-label={column.label} checked={!!v} onChange={(e) => save(e.target.checked)} className="size-4 accent-[var(--color-brand)]" />;
      break;
    case "select": {
      const opt = column.options.find((o) => o.value === v);
      input = (
        <select aria-label={column.label} value={typeof v === "string" ? v : ""} onChange={(e) => save(e.target.value || null)} className={cn(selectClass, common, opt ? TONE_TEXT[opt.color] : "text-fg-faint")}>
          <option value="">—</option>
          {column.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.value}
            </option>
          ))}
        </select>
      );
      break;
    }
    case "date":
      input = <input type="date" aria-label={column.label} value={typeof v === "string" ? v : ""} onChange={(e) => save(e.target.value || null)} className={cn(selectClass, common, "[color-scheme:dark]")} />;
      break;
    default:
      input = <TextCell label={column.label} numeric={column.type === "number"} value={v} className={common} onCommit={save} />;
  }
  return (
    <div title={error ?? undefined} className={cn(error && "rounded-md ring-1 ring-bad/60")}>
      {input}
    </div>
  );
}

function TextCell({ value, onCommit, numeric, className, label }: { value: CustomValue; onCommit: (v: CustomValue) => void; numeric: boolean; className: string; label: string }) {
  const [draft, setDraft] = useState(value == null ? "" : String(value));
  const [seen, setSeen] = useState(value);
  if (seen !== value) {
    setSeen(value);
    setDraft(value == null ? "" : String(value));
  }
  const commit = () => {
    const t = draft.trim();
    const next = t === "" ? null : numeric ? Number(t.replace(/[$,\s]/g, "")) : t;
    if (numeric && next !== null && !Number.isFinite(next)) return setDraft(value == null ? "" : String(value));
    if (next !== value) onCommit(next);
  };
  return (
    <input
      aria-label={label}
      inputMode={numeric ? "decimal" : undefined}
      value={draft}
      placeholder="—"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") setDraft(value == null ? "" : String(value));
      }}
      className={cn(selectClass, className, "placeholder:text-fg-faint")}
    />
  );
}

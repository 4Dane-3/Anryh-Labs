"use client";

import { useState, useTransition } from "react";
import { Plus, Trash2 } from "lucide-react";
import { deleteColumn, saveColumn } from "@/app/admin/crm/actions";
import { COLUMN_TYPES, OPTION_COLORS, type ColumnType, type CrmColumn, type OptionColor } from "@/lib/crm/types";
import { Button, inputClass, Label } from "@/components/dashboard/ui";
import { Modal, TONE_DOT } from "@/components/admin/crm/shared";
import { cn } from "@/lib/utils";

const TYPE_LABEL: Record<ColumnType, string> = { text: "Text", select: "Choice (e.g. Said yes / maybe / no)", checkbox: "Checkbox", date: "Date", number: "Number" };

/** Adds a column, or edits/deletes one (its type is fixed once made; the label and options can change). */
export function ColumnEditor({ open, onClose, column, onSaved }: { open: boolean; onClose: () => void; column?: CrmColumn | null; onSaved?: (c: CrmColumn) => void }) {
  return (
    <Modal open={open} onClose={onClose} title={column ? `Edit “${column.label}”` : "Add a column"}>
      {open && <Form key={column?.id ?? "new"} column={column ?? null} onClose={onClose} onSaved={onSaved} />}
    </Modal>
  );
}

function Form({ column, onClose, onSaved }: { column: CrmColumn | null; onClose: () => void; onSaved?: (c: CrmColumn) => void }) {
  const [label, setLabel] = useState(column?.label ?? "");
  const [type, setType] = useState<ColumnType>(column?.type ?? "select");
  const [options, setOptions] = useState<{ value: string; color: OptionColor }[]>(
    column?.options.length ? column.options : [{ value: "Said yes", color: "good" }, { value: "Said maybe", color: "accent" }, { value: "Said no", color: "bad" }],
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    start(async () => {
      setError(null);
      const r = await saveColumn({ id: column?.id, label, type, options: options.filter((o) => o.value.trim()) });
      if (!r.ok) return setError(r.error);
      onSaved?.(r.column);
      onClose();
    });
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <Label htmlFor="col-label">Column name</Label>
        <input id="col-label" autoFocus className={inputClass} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Response, Follow up on, Policy type" maxLength={60} />
      </div>
      <div>
        <Label htmlFor="col-type">Type</Label>
        <select id="col-type" className={cn(inputClass, "[&>option]:bg-[#26282a]")} value={type} disabled={!!column} onChange={(e) => setType(e.target.value as ColumnType)}>
          {COLUMN_TYPES.map((t) => (
            <option key={t} value={t}>
              {TYPE_LABEL[t]}
            </option>
          ))}
        </select>
        {column && <p className="mt-1 text-[12px] text-fg-faint">A column&apos;s type can&apos;t change. Delete it and add a new one instead.</p>}
      </div>
      {type === "select" && (
        <div>
          <Label>Options</Label>
          <ul className="space-y-2">
            {options.map((o, i) => (
              <li key={i} className="flex items-center gap-2">
                <div className="flex shrink-0 gap-1">
                  {OPTION_COLORS.map((c) => (
                    <button
                      type="button"
                      key={c}
                      aria-label={`Colour ${c}`}
                      onClick={() => setOptions(options.map((x, j) => (j === i ? { ...x, color: c } : x)))}
                      className={cn("size-5 rounded-full border-2", TONE_DOT[c], o.color === c ? "border-fg" : "border-transparent opacity-60 hover:opacity-100")}
                    />
                  ))}
                </div>
                <input aria-label={`Option ${i + 1}`} className={inputClass} value={o.value} maxLength={60} onChange={(e) => setOptions(options.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} />
                <Button type="button" size="sm" variant="ghost" aria-label="Remove option" onClick={() => setOptions(options.filter((_, j) => j !== i))}>
                  <Trash2 />
                </Button>
              </li>
            ))}
          </ul>
          <Button type="button" size="sm" variant="ghost" className="mt-2" onClick={() => setOptions([...options, { value: "", color: "neutral" }])}>
            <Plus /> Add option
          </Button>
        </div>
      )}
      {error && <p className="text-[13px] text-bad">{error}</p>}
      <div className="flex items-center justify-between gap-2 pt-1">
        {column ? (
          <Button
            type="button"
            variant="danger"
            size="sm"
            disabled={pending}
            onClick={() => {
              if (!confirm(`Delete the “${column.label}” column? Its values disappear from every client.`)) return;
              start(async () => {
                const r = await deleteColumn(column.id);
                if (r.ok) onClose();
                else setError(r.error);
              });
            }}
          >
            <Trash2 /> Delete column
          </Button>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={pending}>
            {pending ? "Saving…" : column ? "Save" : "Add column"}
          </Button>
        </div>
      </div>
    </form>
  );
}

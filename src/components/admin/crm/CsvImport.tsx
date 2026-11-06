"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FileUp } from "lucide-react";
import { importClients, saveColumn } from "@/app/admin/crm/actions";
import { guessField, parseCsv } from "@/lib/crm/csv";
import type { CrmColumn, CustomValue, ImportRow, OptionColor } from "@/lib/crm/types";
import { Button, inputClass } from "@/components/dashboard/ui";
import { Modal } from "@/components/admin/crm/shared";
import { cn } from "@/lib/utils";

const BUILT_IN = [
  ["name", "Full name"],
  ["first", "First name"],
  ["last", "Last name"],
  ["email", "Email"],
  ["phone", "Phone"],
  ["company", "Company"],
  ["status", "Status (lead, contacted, meeting, client, lost)"],
  ["note", "Note (added to the notes thread)"],
] as const;

type Target = "" | (typeof BUILT_IN)[number][0] | `col:${string}` | "new";
const CHUNK = 1000;
const MAX_ROWS = 20_000;

/** Upload a CSV, map its columns to client fields (or custom columns), and import. */
export function CsvImport({ open, onClose, columns }: { open: boolean; onClose: () => void; columns: CrmColumn[] }) {
  return (
    <Modal open={open} onClose={onClose} title="Import clients from a CSV" wide>
      {open && <Importer columns={columns} onClose={onClose} />}
    </Modal>
  );
}

function Importer({ columns, onClose }: { columns: CrmColumn[]; onClose: () => void }) {
  const router = useRouter();
  const [file, setFile] = useState<string | null>(null);
  const [rows, setRows] = useState<string[][]>([]);
  const [map, setMap] = useState<Target[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [result, setResult] = useState<{ imported: number; duplicates: number; invalid: number } | null>(null);
  const [pending, start] = useTransition();

  const headers = rows[0] ?? [];
  const body = useMemo(() => rows.slice(1), [rows]);

  const load = async (f: File) => {
    setError(null);
    setResult(null);
    if (f.size > 10 * 1024 * 1024) return setError("That file is over 10 MB. Split it into smaller files.");
    const parsed = parseCsv(await f.text());
    if (parsed.length < 2) return setError("That file has no rows under its header line.");
    if (parsed.length - 1 > MAX_ROWS) return setError(`That file has ${parsed.length - 1} rows; import at most ${MAX_ROWS.toLocaleString()} at a time.`);
    setFile(f.name);
    setRows(parsed);
    const used = new Set<string>();
    setMap(
      parsed[0].map((h) => {
        const col = columns.find((c) => c.label.toLowerCase() === h.trim().toLowerCase());
        const t: Target = col ? `col:${col.id}` : (guessField(h) ?? "");
        if (!t || used.has(t)) return "";
        used.add(t);
        return t;
      }),
    );
  };

  const hasName = map.includes("name") || map.includes("first") || map.includes("last");

  const run = () =>
    start(async () => {
      setError(null);
      // Columns marked "new" become custom columns first: a choice column when the CSV has a handful of
      // distinct values (like "Said yes / Said maybe"), text otherwise
      const finalMap = [...map];
      for (let i = 0; i < finalMap.length; i++) {
        if (finalMap[i] !== "new") continue;
        const values = [...new Set(body.map((r) => (r[i] ?? "").trim()).filter(Boolean))];
        const asSelect = values.length > 0 && values.length <= 8 && body.length >= values.length * 2;
        const colors: OptionColor[] = ["neutral", "accent", "good", "bad"];
        const r = await saveColumn({ label: headers[i].trim() || `Column ${i + 1}`, type: asSelect ? "select" : "text", options: asSelect ? values.map((v, k) => ({ value: v, color: colors[k % 4] })) : [] });
        if (!r.ok) return setError(`Couldn't add the “${headers[i]}” column: ${r.error}`);
        finalMap[i] = `col:${r.column.id}`;
      }
      const out: ImportRow[] = body.map((r) => {
        const get = (t: Target) => {
          const i = finalMap.indexOf(t);
          return i >= 0 ? (r[i] ?? "").trim() : "";
        };
        const custom: Record<string, CustomValue> = {};
        finalMap.forEach((t, i) => {
          if (t.startsWith("col:") && (r[i] ?? "").trim()) custom[t.slice(4)] = r[i].trim();
        });
        return { name: get("name") || [get("first"), get("last")].filter(Boolean).join(" "), email: get("email"), phone: get("phone"), company: get("company"), status: get("status"), note: get("note"), custom };
      });
      const total = { imported: 0, duplicates: 0, invalid: 0 };
      for (let i = 0; i < out.length; i += CHUNK) {
        setProgress(`Importing ${Math.min(i + CHUNK, out.length).toLocaleString()} of ${out.length.toLocaleString()}…`);
        const r = await importClients(out.slice(i, i + CHUNK));
        if (!r.ok) {
          setProgress(null);
          return setError(r.error);
        }
        total.imported += r.imported;
        total.duplicates += r.duplicates;
        total.invalid += r.invalid;
      }
      setProgress(null);
      setResult(total);
      router.refresh();
    });

  if (result)
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-3">
          <Count label="Imported" value={result.imported} tone="good" />
          <Count label="Skipped: already in your list" value={result.duplicates} />
          <Count label="Skipped: no name or bad email" value={result.invalid} tone={result.invalid ? "bad" : undefined} />
        </div>
        <p className="text-[13px] text-fg-muted">Duplicates are matched by email and by phone number, against your list and within the file.</p>
        <div className="flex justify-end">
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    );

  if (!file)
    return (
      <div className="space-y-3">
        <label className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border border-dashed border-line-strong px-6 py-12 text-center hover:border-brand/50 hover:bg-white/[0.02]">
          <FileUp className="size-6 text-fg-muted" />
          <span className="text-sm font-medium text-fg">Choose a CSV file</span>
          <span className="text-[12px] text-fg-faint">Exported from Excel, Google Sheets, a CRM or a lead list. The first row should be the column names.</span>
          <input
            type="file"
            accept=".csv,text/csv,.tsv,text/tab-separated-values,.txt"
            className="sr-only"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) load(f);
            }}
          />
        </label>
        {error && <p className="text-[13px] text-bad">{error}</p>}
      </div>
    );

  return (
    <div className="space-y-4">
      <p className="text-[13px] text-fg-muted">
        <span className="font-medium text-fg">{file}</span> · {body.length.toLocaleString()} row{body.length === 1 ? "" : "s"}. Match each CSV column to a field. &ldquo;New column&rdquo; adds it to your table.
      </p>
      <div className="max-h-[50vh] overflow-y-auto rounded-xl border border-line">
        <table className="w-full text-left text-[13px]">
          <thead className="sticky top-0 bg-[#26282a] font-mono text-[11px] text-fg-faint">
            <tr>
              <th className="px-3 py-2 font-normal">CSV column</th>
              <th className="px-3 py-2 font-normal">Example</th>
              <th className="px-3 py-2 font-normal">Import as</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {headers.map((h, i) => (
              <tr key={i}>
                <td className="px-3 py-2 font-medium text-fg">{h || <span className="text-fg-faint">(blank)</span>}</td>
                <td className="max-w-[200px] truncate px-3 py-2 text-fg-muted">{body.find((r) => r[i]?.trim())?.[i] ?? "—"}</td>
                <td className="px-3 py-2">
                  <select
                    aria-label={`Import ${h} as`}
                    value={map[i] ?? ""}
                    onChange={(e) => {
                      const t = e.target.value as Target;
                      // Each field takes one CSV column; picking it again moves it here
                      setMap(map.map((x, j) => (j === i ? t : t && t !== "new" && x === t ? "" : x)));
                    }}
                    className={cn(inputClass, "py-1.5 [&>option]:bg-[#26282a] [&>optgroup]:bg-[#26282a]", !map[i] && "text-fg-faint")}
                  >
                    <option value="">Don&apos;t import</option>
                    <optgroup label="Client">
                      {BUILT_IN.map(([k, l]) => (
                        <option key={k} value={k}>
                          {l}
                        </option>
                      ))}
                    </optgroup>
                    <optgroup label="Your columns">
                      {columns.map((c) => (
                        <option key={c.id} value={`col:${c.id}`}>
                          {c.label}
                        </option>
                      ))}
                      <option value="new">New column: “{h.trim() || `Column ${i + 1}`}”</option>
                    </optgroup>
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!hasName && <p className="text-[13px] text-brand">Match a name column (full name, or first and last) to import.</p>}
      {error && <p className="text-[13px] text-bad">{error}</p>}
      <div className="flex items-center justify-between gap-2">
        <Button variant="ghost" onClick={() => { setFile(null); setRows([]); }}>
          Choose another file
        </Button>
        <div className="flex items-center gap-3">
          {progress && <span className="font-mono text-[12px] text-fg-muted">{progress}</span>}
          <Button variant="primary" disabled={!hasName || pending} onClick={run}>
            {pending ? "Importing…" : `Import ${body.length.toLocaleString()} row${body.length === 1 ? "" : "s"}`}
          </Button>
        </div>
      </div>
    </div>
  );
}

function Count({ label, value, tone }: { label: string; value: number; tone?: "good" | "bad" }) {
  return (
    <div className="rounded-lg border border-line bg-ink-raised px-4 py-3">
      <p className="font-mono text-[11px] text-fg-faint">{label}</p>
      <p className={cn("mt-1 font-mono text-xl tabular-nums", tone === "good" ? "text-good" : tone === "bad" ? "text-bad" : "text-fg")}>{value.toLocaleString()}</p>
    </div>
  );
}

"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { DateTime } from "luxon";
import { ChevronLeft, ChevronRight, Download, FileUp, Mail, Pencil, Plus, Search, Trash2, UserPlus } from "lucide-react";
import { deleteClient, moveColumn, setClientField } from "@/app/admin/crm/actions";
import { CLIENT_STATUSES, clientLabel, STATUS_LABEL, type ClientStatus, type CrmClient, type CrmColumn, type CrmSettings } from "@/lib/crm/types";
import { Button, EmptyState, inputClass, Panel } from "@/components/dashboard/ui";
import { CustomCell } from "@/components/admin/crm/CustomCell";
import { ColumnEditor } from "@/components/admin/crm/ColumnEditor";
import { CsvImport } from "@/components/admin/crm/CsvImport";
import { ClientForm } from "@/components/admin/crm/ClientForm";
import { MeetingBadge, selectClass, STATUS_TONE } from "@/components/admin/crm/shared";
import { BulkFollowUp, FollowUpCopyForm } from "@/components/admin/crm/FollowUps";
import { CADENCES, type FollowUpCopy } from "@/lib/crm/followups";
import { cn } from "@/lib/utils";

const TONE_TEXT = { neutral: "text-fg-muted", accent: "text-brand", good: "text-good", bad: "text-bad" } as const;
const PAGE = 200;

function csvEscape(v: unknown) {
  const s = v == null ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function ClientsView({ clients, columns, settings, followUpCopy }: { clients: CrmClient[]; columns: CrmColumn[]; settings: CrmSettings; followUpCopy: FollowUpCopy }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [now] = useState(() => Date.now());
  const [status, setStatus] = useState<ClientStatus | "all">("all");
  const [filterCol, setFilterCol] = useState<{ id: string; value: string } | null>(null);
  const [limit, setLimit] = useState(PAGE);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [modal, setModal] = useState<null | "add" | "import" | "column" | "followup" | "copy">(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editCol, setEditCol] = useState<CrmColumn | null>(null);
  const [pending, start] = useTransition();
  const [statusOverride, setStatusOverride] = useState<Record<string, ClientStatus>>({});

  const selectCols = columns.filter((c) => c.type === "select" || c.type === "checkbox");
  const counts = useMemo(() => {
    const m: Record<string, number> = { all: clients.length };
    for (const c of clients) m[statusOverride[c.id] ?? c.status] = (m[statusOverride[c.id] ?? c.status] ?? 0) + 1;
    return m;
  }, [clients, statusOverride]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const digits = needle.replace(/\D/g, "");
    return clients.filter((c) => {
      if (status !== "all" && (statusOverride[c.id] ?? c.status) !== status) return false;
      if (filterCol) {
        const v = c.custom[filterCol.id];
        if (filterCol.value === "__empty" ? v != null && v !== "" : String(v ?? "") !== filterCol.value) return false;
      }
      if (!needle) return true;
      return (
        c.name?.toLowerCase().includes(needle) ||
        c.email?.includes(needle) ||
        c.company?.toLowerCase().includes(needle) ||
        (digits.length >= 3 && c.phone?.replace(/\D/g, "").includes(digits)) ||
        Object.values(c.custom).some((v) => typeof v === "string" && v.toLowerCase().includes(needle))
      );
    });
  }, [clients, q, status, filterCol, statusOverride]);

  const exportCsv = () => {
    const head = ["Contact", "Email", "Phone", "Company", "Status", ...columns.map((c) => c.label), "Added"];
    const lines = shown.map((c) => [c.name, c.email, c.phone, c.company, STATUS_LABEL[c.status], ...columns.map((col) => c.custom[col.id]), c.created_at.slice(0, 10)].map(csvEscape).join(","));
    const blob = new Blob([[head.map(csvEscape).join(","), ...lines].join("\r\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `clients-${DateTime.now().toISODate()}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const allShownSelected = shown.length > 0 && shown.slice(0, limit).every((c) => selected.has(c.id));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <div className="relative w-full max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-faint" />
            <input aria-label="Search clients" className={cn(inputClass, "pl-9")} placeholder="Search name, email, phone, company" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          {selectCols.length > 0 && (
            <select
              aria-label="Filter by column"
              className={cn(inputClass, "w-auto py-2 [&>option]:bg-[#26282a] [&>optgroup]:bg-[#26282a]", !filterCol && "text-fg-faint")}
              value={filterCol ? `${filterCol.id}::${filterCol.value}` : ""}
              onChange={(e) => {
                const [id, value] = e.target.value.split("::");
                setFilterCol(id ? { id, value } : null);
              }}
            >
              <option value="">All columns</option>
              {selectCols.map((c) => (
                <optgroup key={c.id} label={c.label}>
                  {(c.type === "checkbox" ? [{ value: "true", label: "Checked" }] : c.options.map((o) => ({ value: o.value, label: o.value }))).map((o) => (
                    <option key={o.value} value={`${c.id}::${o.value}`}>
                      {c.label}: {o.label}
                    </option>
                  ))}
                  <option value={`${c.id}::__empty`}>{c.label}: blank</option>
                </optgroup>
              ))}
            </select>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="ghost" onClick={() => setModal("copy")}>
            <Mail /> Follow-up email
          </Button>
          <Button size="sm" variant="ghost" onClick={exportCsv} disabled={!shown.length}>
            <Download /> Export
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setModal("import")}>
            <FileUp /> Import CSV
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setModal("column")}>
            <Plus /> Add column
          </Button>
          <Button size="sm" variant="primary" onClick={() => setModal("add")}>
            <UserPlus /> Add client
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {(["all", ...CLIENT_STATUSES] as const).map((s) => (
          <button
            key={s}
            onClick={() => setStatus(s)}
            className={cn(
              "rounded-full border px-3 py-1 text-[12px] transition-colors",
              status === s ? "border-brand/50 bg-brand/10 text-fg" : "border-line text-fg-muted hover:border-line-strong hover:text-fg",
            )}
          >
            {s === "all" ? "All" : STATUS_LABEL[s]} <span className="font-mono text-fg-faint">{counts[s] ?? 0}</span>
          </button>
        ))}
      </div>

      {selected.size > 0 && (
        <div className="flex items-center gap-3 rounded-lg border border-line bg-ink-raised px-4 py-2 text-[13px]">
          <span>{selected.size} selected</span>
          <Button size="sm" variant="secondary" onClick={() => setModal("followup")}>
            <Mail /> Start follow-ups
          </Button>
          <Button
            size="sm"
            variant="danger"
            disabled={pending}
            onClick={() => {
              if (!confirm(`Delete ${selected.size} client${selected.size === 1 ? "" : "s"}, with their notes and meetings? This can't be undone.`)) return;
              start(async () => {
                for (const id of selected) await deleteClient(id);
                setSelected(new Set());
                router.refresh();
              });
            }}
          >
            <Trash2 /> {pending ? "Deleting…" : "Delete"}
          </Button>
          <button className="text-fg-muted hover:text-fg" onClick={() => setSelected(new Set())}>
            Clear
          </button>
        </div>
      )}

      {notice && (
        <div className="flex items-start justify-between gap-3 rounded-lg border border-good/30 bg-good/10 px-4 py-2 text-[13px] text-fg">
          <span>{notice}</span>
          <button className="text-fg-muted hover:text-fg" onClick={() => setNotice(null)}>Dismiss</button>
        </div>
      )}

      <Panel>
        {clients.length === 0 ? (
          <EmptyState
            title="No clients yet"
            action={
              <div className="flex gap-2">
                <Button size="sm" variant="secondary" onClick={() => setModal("import")}>
                  <FileUp /> Import CSV
                </Button>
                <Button size="sm" variant="primary" onClick={() => setModal("add")}>
                  <UserPlus /> Add client
                </Button>
              </div>
            }
          >
            Add them one at a time, or import a CSV from a spreadsheet or another CRM.
          </EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-left text-[13px]">
              <thead className="font-mono text-[11px] text-fg-faint">
                <tr className="border-b border-line">
                  <th className="w-10 px-4 py-2.5">
                    <input
                      type="checkbox"
                      aria-label="Select all shown"
                      checked={allShownSelected}
                      onChange={(e) => setSelected(e.target.checked ? new Set(shown.slice(0, limit).map((c) => c.id)) : new Set())}
                      className="size-3.5 accent-[var(--color-brand)]"
                    />
                  </th>
                  <th className="px-3 py-2.5 font-normal">Client</th>
                  <th className="px-3 py-2.5 font-normal">Email</th>
                  <th className="px-3 py-2.5 font-normal">Phone</th>
                  <th className="px-3 py-2.5 font-normal">Company</th>
                  <th className="px-3 py-2.5 font-normal">Status</th>
                  {columns.map((c, i) => (
                    <th key={c.id} className="group min-w-[140px] px-3 py-2.5 font-normal">
                      <span className="flex items-center gap-1">
                        <button onClick={() => setEditCol(c)} className="flex items-center gap-1 text-fg-muted hover:text-fg" title="Edit column">
                          {c.label} <Pencil className="size-3 opacity-0 group-hover:opacity-100" />
                        </button>
                        <span className="ml-auto flex opacity-0 group-hover:opacity-100">
                          {i > 0 && (
                            <button aria-label={`Move ${c.label} left`} onClick={() => start(async () => { await moveColumn(c.id, -1); router.refresh(); })} className="rounded p-0.5 hover:bg-white/[0.06]">
                              <ChevronLeft className="size-3" />
                            </button>
                          )}
                          {i < columns.length - 1 && (
                            <button aria-label={`Move ${c.label} right`} onClick={() => start(async () => { await moveColumn(c.id, 1); router.refresh(); })} className="rounded p-0.5 hover:bg-white/[0.06]">
                              <ChevronRight className="size-3" />
                            </button>
                          )}
                        </span>
                      </span>
                    </th>
                  ))}
                  <th className="px-3 py-2.5 font-normal">
                    <button onClick={() => setModal("column")} className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-fg-faint hover:bg-white/[0.06] hover:text-fg" aria-label="Add column">
                      <Plus className="size-3.5" />
                    </button>
                  </th>
                  <th className="px-3 py-2.5 font-normal">Next meeting</th>
                  <th className="px-4 py-2.5 text-right font-normal">Added</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {shown.slice(0, limit).map((c) => {
                  const st = statusOverride[c.id] ?? c.status;
                  return (
                    <tr key={c.id} className={cn("hover:bg-white/[0.02]", selected.has(c.id) && "bg-brand/[0.04]")}>
                      <td className="px-4 py-1.5">
                        <input
                          type="checkbox"
                          aria-label={`Select ${clientLabel(c)}`}
                          checked={selected.has(c.id)}
                          onChange={(e) => {
                            const next = new Set(selected);
                            if (e.target.checked) next.add(c.id);
                            else next.delete(c.id);
                            setSelected(next);
                          }}
                          className="size-3.5 accent-[var(--color-brand)]"
                        />
                      </td>
                      <td className="px-3 py-1.5">
                        <Link href={`/admin/clients/${c.id}`} className="font-medium text-fg hover:text-brand">
                          {clientLabel(c)}
                        </Link>
                        {c.followup && (
                          <span title={`Follow-ups ${c.followup.status === "paused" ? "paused" : `on, ${CADENCES[c.followup.cadence].label.toLowerCase()}`}`} className={cn("ml-1.5 inline-flex translate-y-[2px]", c.followup.status === "paused" ? "text-fg-faint" : "text-brand")}>
                            <Mail className="size-3.5" />
                          </span>
                        )}
                      </td>
                      <td className="max-w-[220px] truncate px-3 py-1.5 text-fg-muted">{c.email ?? <span className="text-fg-faint">—</span>}</td>
                      <td className="whitespace-nowrap px-3 py-1.5 font-mono text-[12px] text-fg-muted">{c.phone ?? <span className="text-fg-faint">—</span>}</td>
                      <td className="max-w-[180px] truncate px-3 py-1.5 text-fg-muted">{c.company ?? <span className="text-fg-faint">—</span>}</td>
                      <td className="px-3 py-1.5">
                        <select
                          aria-label={`Status of ${clientLabel(c)}`}
                          value={st}
                          onChange={(e) => {
                            const v = e.target.value as ClientStatus;
                            setStatusOverride({ ...statusOverride, [c.id]: v });
                            start(async () => {
                              const r = await setClientField(c.id, "status", v);
                              if (!r.ok) setStatusOverride({ ...statusOverride, [c.id]: c.status });
                            });
                          }}
                          className={cn(selectClass, TONE_TEXT[STATUS_TONE[st]])}
                        >
                          {CLIENT_STATUSES.map((s) => (
                            <option key={s} value={s}>
                              {STATUS_LABEL[s]}
                            </option>
                          ))}
                        </select>
                      </td>
                      {columns.map((col) => (
                        <td key={col.id} className="px-3 py-1.5">
                          <CustomCell clientId={c.id} column={col} value={c.custom[col.id]} />
                        </td>
                      ))}
                      <td />
                      <td className="whitespace-nowrap px-3 py-1.5 text-[12px]">
                        {c.next_meeting ? (
                          <span className="flex items-center gap-2">
                            <span className="text-fg-muted">{DateTime.fromISO(c.next_meeting.starts_at).setZone(settings.timezone).toFormat("LLL d, h:mm a")}</span>
                            <MeetingBadge meeting={c.next_meeting} timezone={settings.timezone} now={now} />
                          </span>
                        ) : (
                          <span className="text-fg-faint">—</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-1.5 text-right font-mono text-[11px] text-fg-faint">{DateTime.fromISO(c.created_at).toFormat("LLL d, yyyy")}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {shown.length === 0 && <EmptyState title="No clients match">Try a different search or filter.</EmptyState>}
            {shown.length > limit && (
              <div className="border-t border-line px-4 py-3 text-center">
                <Button size="sm" variant="ghost" onClick={() => setLimit(limit + PAGE)}>
                  Show more ({(shown.length - limit).toLocaleString()} left)
                </Button>
              </div>
            )}
          </div>
        )}
      </Panel>
      <p className="font-mono text-[11px] text-fg-faint">
        {shown.length.toLocaleString()} of {clients.length.toLocaleString()} clients
      </p>

      <ClientForm open={modal === "add"} onClose={() => setModal(null)} />
      <CsvImport open={modal === "import"} onClose={() => setModal(null)} columns={columns} />
      {followUpCopy && <FollowUpCopyForm open={modal === "copy"} onClose={() => setModal(null)} copy={followUpCopy} />}
      <BulkFollowUp
        open={modal === "followup"}
        onClose={() => setModal(null)}
        clientIds={[...selected]}
        onDone={(m) => {
          setModal(null);
          setSelected(new Set());
          setNotice(m);
          router.refresh();
        }}
      />
      <ColumnEditor open={modal === "column" || !!editCol} column={editCol} onClose={() => { setModal(null); setEditCol(null); router.refresh(); }} />
    </div>
  );
}

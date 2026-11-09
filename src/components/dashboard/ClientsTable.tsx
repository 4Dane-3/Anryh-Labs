"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { DateTime } from "luxon";
import { Plus, Search } from "lucide-react";
import type { Client } from "@/lib/dashboard/clients";
import { ClientCard, SOURCE_LABEL, originBadge, statusBadge, type Emailing } from "@/components/dashboard/ClientCard";
import { AddClient } from "@/components/dashboard/AddClient";
import { Badge, Button, EmptyState, Panel, inputClass } from "@/components/dashboard/ui";
import { badOutcome, outcomeLabel } from "@/lib/outcomes";
import { cn } from "@/lib/utils";

const FILTERS = [
  { key: "prospect", label: "Prospects" },
  { key: "current", label: "Current" },
  { key: "not_interested", label: "Not interested" },
  { key: "all", label: "All" },
] as const;

type Filter = (typeof FILTERS)[number]["key"];

const ORIGINS = [
  { key: "all", label: "Everyone" },
  { key: "migz", label: "From Migz" },
  { key: "personal", label: "Personal" },
] as const;

type Origin = (typeof ORIGINS)[number]["key"];

/** What to show under "Next": an upcoming call, else when they last heard from the agent (or came in). */
function nextLine(c: Client, timezone: string, now: number) {
  if (c.call && c.call.status === "confirmed" && new Date(c.call.endsAt).getTime() >= now) {
    const start = DateTime.fromISO(c.call.startsAt, { zone: timezone });
    return { text: `Call ${start.toFormat("ccc, LLL d · h:mm a")}`, strong: true };
  }
  return { text: `${c.lastAt === c.cameInAt ? "Came in" : "Last activity"} ${DateTime.fromISO(c.lastAt, { zone: timezone }).toRelative()}`, strong: false };
}

export function ClientsTable({ clients, timezone, initialKey, questionOrder, emailing, ruleLines }: { clients: Client[]; timezone: string; initialKey: string | null; questionOrder: string[]; emailing: Emailing; ruleLines?: string[] }) {
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>("prospect");
  const [origin, setOrigin] = useState<Origin>("all");
  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState("");
  // Leads whose form came in without a usable phone number: email only
  const [emailOnly, setEmailOnly] = useState(false);
  const [selectedKey, setSelectedKey] = useState<string | null>(initialKey);
  const selected = clients.find((c) => c.key === selectedKey) ?? null;
  // Captured once per visit so the list stays stable across re-renders
  const [now] = useState(() => Date.now());

  const close = useCallback(() => {
    setSelectedKey(null);
    if (initialKey) router.replace("/dashboard/clients", { scroll: false });
  }, [initialKey, router]);

  const closeAdd = useCallback(() => setAdding(false), []);
  const ofOrigin = useMemo(() => clients.filter((c) => origin === "all" || c.origin === origin), [clients, origin]);
  const counts = useMemo(
    () => ({
      prospect: ofOrigin.filter((c) => c.status === "prospect").length,
      current: ofOrigin.filter((c) => c.status === "current").length,
      not_interested: ofOrigin.filter((c) => c.status === "not_interested").length,
      all: ofOrigin.length,
      emailOnly: ofOrigin.filter((c) => !c.phoneGiven && (filter === "all" || c.status === filter)).length,
    }),
    [ofOrigin, filter],
  );

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const digits = q.replace(/\D/g, "");
    return ofOrigin
      .filter((c) => filter === "all" || c.status === filter)
      .filter((c) => !emailOnly || !c.phoneGiven)
      .filter((c) => !q || c.name.toLowerCase().includes(q) || (c.email ?? "").toLowerCase().includes(q) || (digits.length >= 3 && c.phone.includes(digits)));
  }, [ofOrigin, filter, query, emailOnly]);

  return (
    <>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex gap-1 overflow-x-auto">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={cn("relative whitespace-nowrap rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors", filter === f.key ? "text-fg" : "text-fg-muted hover:text-fg")}
            >
              {filter === f.key && <motion.span layoutId="clients-filter" className="absolute inset-0 rounded-lg bg-white/[0.08]" transition={{ type: "spring", stiffness: 500, damping: 38 }} />}
              <span className="relative">
                {f.label} <span className="text-fg-faint">{counts[f.key]}</span>
              </span>
            </button>
          ))}
          {(counts.emailOnly > 0 || emailOnly) && (
            <button
              onClick={() => setEmailOnly(!emailOnly)}
              aria-pressed={emailOnly}
              title="Leads who didn't give a usable phone number: reach them by email"
              className={cn("whitespace-nowrap rounded-lg border px-3 py-1 text-[13px] transition-colors", emailOnly ? "border-brand/50 bg-brand/10 text-fg" : "border-line text-fg-muted hover:text-fg")}
            >
              Email only <span className="text-fg-faint">{counts.emailOnly}</span>
            </button>
          )}
        </div>
        <div className="flex flex-wrap gap-2 sm:flex-nowrap">
          <select aria-label="Came from" className={`${inputClass} min-w-0 flex-1 sm:w-36 sm:flex-none`} value={origin} onChange={(e) => setOrigin(e.target.value as Origin)}>
            {ORIGINS.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </select>
          <div className="relative order-last w-full sm:order-none sm:w-64">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-faint" />
            <input type="search" placeholder="Search name, email or phone" className={`${inputClass} pl-9`} value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          <Button variant="primary" onClick={() => setAdding(true)}>
            <Plus />
            Add client
          </Button>
        </div>
      </div>

      <Panel className="overflow-hidden">
        <div className="hidden grid-cols-[1.6fr_1.3fr_1.2fr_1fr] gap-4 border-b border-line px-5 py-2.5 text-[11px] font-medium uppercase tracking-wide text-fg-faint md:grid">
          <span>Client</span>
          <span>Came from</span>
          <span>Next</span>
          <span>Status</span>
        </div>

        {rows.length ? (
          <ul className="divide-y divide-line">
            <AnimatePresence initial={false}>
              {rows.map((c, i) => {
                const next = nextLine(c, timezone, now);
                return (
                  <motion.li key={c.key} layout="position" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0, transition: { delay: Math.min(i, 12) * 0.02 } }} exit={{ opacity: 0 }}>
                    <button
                      onClick={() => setSelectedKey(c.key)}
                      className="grid w-full grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1 px-5 py-3 text-left transition-colors hover:bg-white/[0.03] md:grid-cols-[1.6fr_1.3fr_1.2fr_1fr]"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{c.name}</p>
                        <p className="truncate text-[13px] text-fg-muted">{c.email ?? c.phone}</p>
                      </div>
                      <div className="flex items-center gap-1.5 md:hidden">
                        {originBadge(c.origin)}
                        {statusBadge(c.status)}
                      </div>
                      <div className="hidden min-w-0 md:block">
                        <p className="flex items-center gap-1.5 truncate text-[13px] text-fg">
                          {originBadge(c.origin)}
                          <span className="truncate">{c.source === "manual" ? (c.cameFrom.split("·")[1]?.trim() ?? SOURCE_LABEL.manual) : SOURCE_LABEL[c.source]}</span>
                        </p>
                        <p className="truncate text-[12px] text-fg-faint">{c.coverage ?? (c.source === "manual" ? SOURCE_LABEL.manual : c.cameFrom)}</p>
                      </div>
                      <p className={cn("col-span-2 truncate text-[13px] md:col-span-1", next.strong ? "text-fg" : "text-fg-muted")}>{next.text}</p>
                      <div className="hidden flex-wrap items-center gap-1.5 md:flex">
                        {statusBadge(c.status)}
                        {c.outcome && c.outcome !== "not_interested" && <Badge tone={badOutcome(c.outcome) ? "bad" : "neutral"}>{outcomeLabel(c.kind, c.outcome)}</Badge>}
                        {!c.phoneGiven && <Badge>Email only</Badge>}
                      </div>
                    </button>
                  </motion.li>
                );
              })}
            </AnimatePresence>
          </ul>
        ) : (
          <EmptyState title={query ? "No matches" : "Nobody here yet"}>
            {query
              ? "Try a different name, email or phone number."
              : filter === "prospect"
                ? "New leads from your instant forms, quote requests and booked calls show up here. Use Add client for anyone who reached you directly."
                : filter === "current"
                  ? "Mark someone as Current plan (or Sold) on their card and they'll move here."
                  : "Nothing in this list."}
          </EmptyState>
        )}
      </Panel>

      <ClientCard client={selected} timezone={timezone} questionOrder={questionOrder} emailing={emailing} rules={ruleLines} onClose={close} />
      <AddClient
        open={adding}
        onClose={closeAdd}
        onAdded={(key) => {
          setAdding(false);
          setOrigin("all");
          setFilter("all");
          setSelectedKey(key);
        }}
      />
    </>
  );
}

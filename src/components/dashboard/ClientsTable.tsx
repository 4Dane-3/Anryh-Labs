"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { DateTime } from "luxon";
import { Search } from "lucide-react";
import type { ClientBooking } from "@/lib/dashboard/queries";
import { ClientDrawer, statusBadge } from "@/components/dashboard/ClientDrawer";
import { Badge, EmptyState, Panel, inputClass } from "@/components/dashboard/ui";
import { cn } from "@/lib/utils";

const FILTERS = [
  { key: "upcoming", label: "Upcoming" },
  { key: "past", label: "Past" },
  { key: "cancelled", label: "Cancelled" },
  { key: "all", label: "All" },
] as const;

type Filter = (typeof FILTERS)[number]["key"];

export function ClientsTable({
  clients,
  timezone,
  initialId,
  questionOrder,
}: {
  clients: ClientBooking[];
  timezone: string;
  initialId: string | null;
  questionOrder: string[];
}) {
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>("upcoming");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(initialId);
  const selected = clients.find((c) => c.id === selectedId) ?? null;
  // Captured once per visit so filtering stays stable across re-renders
  const [now] = useState(() => Date.now());

  const close = useCallback(() => {
    setSelectedId(null);
    if (initialId) router.replace("/dashboard/clients", { scroll: false });
  }, [initialId, router]);

  const counts = useMemo(() => {
    return {
      upcoming: clients.filter((c) => c.status === "confirmed" && new Date(c.ends_at).getTime() >= now).length,
      past: clients.filter((c) => c.status === "confirmed" && new Date(c.ends_at).getTime() < now).length,
      cancelled: clients.filter((c) => c.status === "cancelled").length,
      all: clients.length,
    };
  }, [clients, now]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const digits = q.replace(/\D/g, "");
    return clients
      .filter((c) => {
        const ended = new Date(c.ends_at).getTime() < now;
        if (filter === "upcoming") return c.status === "confirmed" && !ended;
        if (filter === "past") return c.status === "confirmed" && ended;
        if (filter === "cancelled") return c.status === "cancelled";
        return true;
      })
      .filter(
        (c) =>
          !q ||
          c.name.toLowerCase().includes(q) ||
          c.email.toLowerCase().includes(q) ||
          (digits.length >= 3 && c.phone.includes(digits)),
      )
      .sort((a, b) =>
        filter === "upcoming"
          ? a.starts_at.localeCompare(b.starts_at)
          : b.starts_at.localeCompare(a.starts_at),
      );
  }, [clients, filter, query, now]);

  return (
    <>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex gap-1 overflow-x-auto">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={cn(
                "relative rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors",
                filter === f.key ? "text-fg" : "text-fg-muted hover:text-fg",
              )}
            >
              {filter === f.key && (
                <motion.span
                  layoutId="clients-filter"
                  className="absolute inset-0 rounded-lg bg-white/[0.08]"
                  transition={{ type: "spring", stiffness: 500, damping: 38 }}
                />
              )}
              <span className="relative">
                {f.label} <span className="text-fg-faint">{counts[f.key]}</span>
              </span>
            </button>
          ))}
        </div>
        <div className="relative sm:w-72">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-faint" />
          <input
            type="search"
            placeholder="Search name, email or phone"
            className={`${inputClass} pl-9`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>

      <Panel className="overflow-hidden">
        <div className="hidden grid-cols-[2fr_1.4fr_1fr_1fr] gap-4 border-b border-line px-5 py-2.5 text-[11px] font-medium uppercase tracking-wide text-fg-faint md:grid">
          <span>Client</span>
          <span>Call</span>
          <span>Prep</span>
          <span>Status</span>
        </div>

        {rows.length ? (
          <ul className="divide-y divide-line">
            <AnimatePresence initial={false}>
              {rows.map((c, i) => {
                const start = DateTime.fromISO(c.starts_at, { zone: timezone });
                return (
                  <motion.li
                    key={c.id}
                    layout="position"
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0, transition: { delay: Math.min(i, 12) * 0.02 } }}
                    exit={{ opacity: 0 }}
                  >
                    <button
                      onClick={() => setSelectedId(c.id)}
                      className="grid w-full grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1 px-5 py-3 text-left transition-colors hover:bg-white/[0.03] md:grid-cols-[2fr_1.4fr_1fr_1fr]"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{c.name}</p>
                        <p className="truncate text-[13px] text-fg-muted">{c.email}</p>
                      </div>
                      <div className="text-right text-[13px] text-fg-muted md:text-left">
                        <span className="text-fg">{start.toFormat("ccc, LLL d")}</span>
                        <span className="block md:inline"> · {start.toFormat("h:mm a")}</span>
                      </div>
                      <div className="hidden md:block">
                        {c.intake_completed ? (
                          <Badge tone="good">Answered</Badge>
                        ) : c.answers ? (
                          <Badge tone="accent">Partly</Badge>
                        ) : (
                          <Badge>None yet</Badge>
                        )}
                      </div>
                      <div className="hidden md:block">{statusBadge(c)}</div>
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
              : filter === "upcoming"
                ? "When someone books a call on your page, they'll show up here."
                : "Nothing in this list."}
          </EmptyState>
        )}
      </Panel>

      <ClientDrawer booking={selected} timezone={timezone} questionOrder={questionOrder} onClose={close} />
    </>
  );
}

"use client";

import { useState, useTransition } from "react";
import { setInboundNumber } from "@/app/admin/actions";
import { Button, inputClass, Panel } from "@/components/dashboard/ui";
import { displayPhone } from "@/lib/booking/call";
import { INBOUND_MODE_COPY, isInboundMode } from "@/lib/voice/inbound-rules";

export type InboundRow = {
  id: string;
  full_name: string;
  inbound_mode: string | null;
  inbound_number: string | null;
  inbound_transfer_number: string | null;
  calls: number;
  booked: number;
  minutes: number;
};

function Row({ r }: { r: InboundRow }) {
  const [value, setValue] = useState(r.inbound_number ? displayPhone(r.inbound_number) : "");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const save = () =>
    start(async () => {
      const res = await setInboundNumber(r.id, value);
      setMsg(res.ok ? { ok: true, text: "Saved" } : { ok: false, text: res.error });
    });
  return (
    <div className="grid gap-3 px-5 py-4 sm:grid-cols-[1fr_auto] sm:items-center">
      <div>
        <p className="text-sm font-semibold text-fg">{r.full_name}</p>
        <p className="text-[13px] text-fg-muted">
          {isInboundMode(r.inbound_mode) ? INBOUND_MODE_COPY[r.inbound_mode].short : "No option chosen"}
          {" · "}transfers to {r.inbound_transfer_number ? displayPhone(r.inbound_transfer_number) : "nobody (messages only)"}
          {" · "}last 30 days: {r.calls} calls, {r.booked} booked, {Math.round(r.minutes)} min
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input className={`${inputClass} w-44`} inputMode="tel" placeholder="Not assigned" value={value} onChange={(e) => setValue(e.target.value)} aria-label={`${r.full_name}'s inbound number`} />
        <Button onClick={save} disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
        {msg && <span className={msg.ok ? "text-[13px] text-good" : "text-[13px] text-bad"}>{msg.text}</span>}
      </div>
    </div>
  );
}

export function InboundNumbers({ rows }: { rows: InboundRow[] }) {
  if (!rows.length) return <p className="text-sm text-fg-muted">Nobody has turned on inbound calls yet. Roofers opt in under Settings → Inbound calls.</p>;
  return (
    <Panel className="divide-y divide-line">
      {rows.map((r) => (
        <Row key={r.id} r={r} />
      ))}
    </Panel>
  );
}

"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Check, Loader2 } from "lucide-react";
import { setOutcome } from "@/app/dashboard/actions";
import { Panel, PanelHeader, inputClass } from "@/components/dashboard/ui";
import { CALL_OUTCOMES, LEAD_OUTCOMES, outcomeLabel, type OutcomeKind } from "@/lib/outcomes";
import { cn } from "@/lib/utils";

// "How did it go?": one tap per lead. The dashboard list (Overview, Clients, Calendar) and the page the
// Slack ask's buttons open use the same chips.

export type OutcomeRow = { kind: OutcomeKind; id: string; name: string; at: string; outcome: string | null; premiumCents: number | null; source: "booking" | "page" | "instant_form" };

function Chips({ kind, value, onPick, disabled }: { kind: OutcomeKind; value: string | null; onPick: (o: string) => void; disabled?: boolean }) {
  return (
    <div role="radiogroup" aria-label="What happened" className="flex flex-wrap gap-1.5">
      {(kind === "call" ? CALL_OUTCOMES : LEAD_OUTCOMES).map((o) => (
        <button
          key={o.key}
          type="button"
          role="radio"
          aria-checked={value === o.key}
          disabled={disabled}
          onClick={() => onPick(o.key)}
          className={cn(
            "inline-flex h-8 items-center gap-1 rounded-full border px-3 text-[13px] transition-colors disabled:opacity-60",
            value === o.key
              ? o.key === "no_show" || o.key === "not_reached"
                ? "border-bad/50 bg-bad/10 text-fg"
                : "border-brand/60 bg-brand/[0.12] text-fg"
              : "border-line text-fg-muted hover:border-line-strong hover:text-fg",
          )}
        >
          {value === o.key && <Check className="size-3.5" />}
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** The monthly premium for a sale (optional): saved when they leave the field. */
function Premium({ initialCents, onSave }: { initialCents: number | null; onSave: (dollars: number) => void }) {
  const [v, setV] = useState(initialCents ? String(initialCents / 100) : "");
  return (
    <label className="mt-2 flex items-center gap-2 text-[12px] text-fg-muted">
      Monthly premium (optional)
      <span className="relative">
        <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-faint">$</span>
        <input
          inputMode="decimal"
          className={cn(inputClass, "h-8 w-24 py-1 pl-5 tabular-nums")}
          value={v}
          onChange={(e) => setV(e.target.value)}
          onBlur={() => {
            const n = Number(v.replace(/[^0-9.]/g, ""));
            if (n > 0) onSave(n);
          }}
        />
      </span>
    </label>
  );
}

const SOURCE: Record<OutcomeRow["source"], string> = { booking: "booked call", page: "quote request", instant_form: "instant form" };

function Row({ row, timezone }: { row: OutcomeRow; timezone: string }) {
  const [value, setValue] = useState(row.outcome);
  const [pending, start] = useTransition();
  const [error, setError] = useState(false);
  const save = (outcome: string, premium?: number) =>
    start(async () => {
      const before = value;
      setValue(outcome);
      setError(false);
      const res = await setOutcome(row.kind, row.id, outcome, premium);
      if (!res.ok) {
        setValue(before);
        setError(true);
      }
    });
  const at = new Date(row.at).toLocaleString("en-US", { timeZone: timezone, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  return (
    <li className="flex flex-col gap-2 px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="truncate text-sm text-fg">{row.name}</p>
        <p className="text-[12px] text-fg-faint">
          {SOURCE[row.source]} · {at}
          {pending && <Loader2 className="ml-1.5 inline size-3 animate-spin" />}
          {error && <span className="ml-1.5 text-bad">Couldn&apos;t save</span>}
        </p>
      </div>
      <div className="sm:text-right">
        <Chips kind={row.kind} value={value} onPick={(o) => save(o)} disabled={pending} />
        {value === "sold" && <Premium initialCents={row.premiumCents} onSave={(d) => save("sold", d)} />}
      </div>
    </li>
  );
}

/** "How did these go?": the agent's recent calls and leads with one-tap answers. */
export function OutcomeList({ rows, timezone, title = "How did these go?", description, id }: { rows: OutcomeRow[]; timezone: string; title?: string; description?: string; id?: string }) {
  if (!rows.length) return null;
  return (
    <Panel id={id} className="scroll-mt-24">
      <PanelHeader
        title={title}
        description={description ?? "One tap each. Migz learns which ads bring people who show up and buy, not just people who book, and tells Meta about the good ones."}
      />
      <ul className="divide-y divide-line">
        {rows.map((r) => (
          <Row key={`${r.kind}:${r.id}`} row={r} timezone={timezone} />
        ))}
      </ul>
    </Panel>
  );
}

/** The page a Slack button opens: saves the tapped answer once, then lets the agent change it. */
export function OneTapOutcome({ kind, id, sig, name, when, tapped, current }: { kind: OutcomeKind; id: string; sig: string; name: string; when: string; tapped: string | null; current: string | null }) {
  const [value, setValue] = useState<string | null>(current);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const sent = useRef(false);
  const post = async (outcome: string, premium?: number) => {
    setState("saving");
    setValue(outcome);
    const res = await fetch("/api/outcomes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind, id, s: sig, outcome, premium }) }).catch(() => null);
    setState(res?.ok ? "saved" : "error");
  };
  useEffect(() => {
    // Saved from the browser, so link previews (which don't run scripts) never record an answer
    if (sent.current || !tapped || tapped === current) return;
    sent.current = true;
    void post(tapped);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="space-y-4">
      <div>
        <p className="text-[12px] uppercase tracking-wide text-fg-faint">Migz AI · how did it go?</p>
        <h1 className="mt-1 text-2xl font-normal tracking-[-0.02em] text-fg">{name}</h1>
        <p className="text-[13px] text-fg-muted">{when}</p>
      </div>
      <Chips kind={kind} value={value} onPick={(o) => post(o)} disabled={state === "saving"} />
      {value === "sold" && <Premium initialCents={null} onSave={(d) => post("sold", d)} />}
      <p className={cn("text-[13px]", state === "error" ? "text-bad" : "text-fg-muted")}>
        {state === "saving"
          ? "Saving…"
          : state === "error"
            ? "Couldn't save that. Try again, or answer from your dashboard."
            : value
              ? `Saved: ${outcomeLabel(kind, value)}. Thanks, Migz learns from this. Tap another answer to change it.`
              : "Tap what happened."}
      </p>
    </div>
  );
}

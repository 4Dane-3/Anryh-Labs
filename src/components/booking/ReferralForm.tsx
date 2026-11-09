"use client";

import { useState } from "react";
import { CheckCircle2, Loader2, Plus } from "lucide-react";
import { REFERRAL_PERMISSION_TEXT } from "@/lib/booking/constants";
import { inputClass } from "@/components/booking/BookingWidget";

type Row = { name: string; phone: string; email: string; address: string };
const empty = (): Row => ({ name: "", phone: "", email: "", address: "" });

/** Up to `goal` referral rows (minus those already in), a permission checkbox, and progress toward the reward. */
export function ReferralForm({ token, goal, already, reward }: { token: string; goal: number; already: string[]; reward: string | null }) {
  const [done, setDone] = useState(already);
  const room = Math.max(0, goal - done.length);
  const [rows, setRows] = useState<Row[]>(() => Array.from({ length: Math.min(room, 3) || 0 }, empty));
  const [permission, setPermission] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [problems, setProblems] = useState<Record<number, string>>({});
  const [note, setNote] = useState<string | null>(null);

  const set = (i: number, k: keyof Row, v: string) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  const progress = Math.min(1, done.length / goal);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setProblems({});
    setNote(null);
    try {
      const res = await fetch("/api/referrals", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token, rows, permission }) });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Something went wrong.");
        setProblems(Object.fromEntries((data.problems ?? []).map((p: { index: number; error: string }) => [p.index, p.error])));
        return;
      }
      const next = [...done, ...(data.added as string[]).map((n) => n.split(/\s+/)[0])];
      setDone(next);
      const left = Math.max(0, goal - next.length);
      setRows(Array.from({ length: Math.min(left, 1) }, empty));
      setPermission(false);
      const skipped = (data.skipped as { name: string; reason: string }[]).map((s) => `${s.name} (${s.reason})`);
      setNote(
        [
          data.added.length ? `Thanks! Added ${data.added.join(", ")}.` : "",
          skipped.length ? `Not counted: ${skipped.join(", ")}.` : "",
          data.earned && reward ? `That's ${goal}: you've earned the ${reward} gift card. We'll be in touch!` : "",
        ]
          .filter(Boolean)
          .join(" "),
      );
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-4">
      <div className="h-2 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-valuemin={0} aria-valuemax={goal} aria-valuenow={done.length} aria-label="Referrals so far">
        <div className="h-full rounded-full bg-blue-700 transition-all" style={{ width: `${progress * 100}%` }} />
      </div>
      {done.length > 0 && (
        <ul className="mt-4 flex flex-wrap gap-2">
          {done.map((n, i) => (
            <li key={`${n}-${i}`} className="flex items-center gap-1.5 rounded-full bg-blue-50 px-3 py-1 text-sm text-blue-900 ring-1 ring-blue-100">
              <CheckCircle2 className="size-4 text-blue-700" /> {n}
            </li>
          ))}
        </ul>
      )}
      {note && (
        <p className="mt-4 rounded-xl bg-blue-50 p-4 text-sm text-slate-700 ring-1 ring-blue-100" role="status">
          {note}
        </p>
      )}

      {room > 0 && (
        <form onSubmit={submit} className="mt-6 space-y-4">
          {rows.map((r, i) => (
            <fieldset key={i} className={`rounded-2xl p-4 ring-1 sm:p-5 ${problems[i] ? "ring-red-300" : "ring-slate-200"}`}>
              <legend className="px-1 text-sm font-semibold text-slate-700">Friend {done.length + i + 1}</legend>
              <div className="grid gap-3 sm:grid-cols-2">
                <input className={inputClass} placeholder="Name" autoComplete="off" value={r.name} onChange={(e) => set(i, "name", e.target.value)} aria-label={`Friend ${done.length + i + 1} name`} />
                <input className={inputClass} placeholder="Phone" inputMode="tel" autoComplete="off" value={r.phone} onChange={(e) => set(i, "phone", e.target.value)} aria-label={`Friend ${done.length + i + 1} phone`} />
                <input className={inputClass} placeholder="Email (optional)" type="email" autoComplete="off" value={r.email} onChange={(e) => set(i, "email", e.target.value)} aria-label={`Friend ${done.length + i + 1} email`} />
                <input className={inputClass} placeholder="Home address (optional)" autoComplete="off" value={r.address} onChange={(e) => set(i, "address", e.target.value)} aria-label={`Friend ${done.length + i + 1} address`} />
              </div>
              {problems[i] && <p className="mt-2 text-sm text-red-600">{problems[i]}</p>}
            </fieldset>
          ))}
          {rows.length < room && (
            <button type="button" onClick={() => setRows((rs) => [...rs, empty()])} className="flex items-center gap-1.5 text-sm font-medium text-blue-700 hover:underline">
              <Plus className="size-4" /> Add another person
            </button>
          )}
          <label className="flex items-start gap-2.5 text-sm text-slate-600">
            <input type="checkbox" className="mt-0.5 size-4 shrink-0 accent-blue-700" checked={permission} onChange={(e) => setPermission(e.target.checked)} />
            <span>{REFERRAL_PERMISSION_TEXT}</span>
          </label>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button type="submit" disabled={busy || !permission} className="flex w-full items-center justify-center gap-2 rounded-full bg-blue-700 px-5 py-3.5 font-semibold text-white transition hover:bg-blue-800 disabled:opacity-50 sm:w-auto">
            {busy && <Loader2 className="size-4 animate-spin" />} Send referrals
          </button>
        </form>
      )}
    </div>
  );
}

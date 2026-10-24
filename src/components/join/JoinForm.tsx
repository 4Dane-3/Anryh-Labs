"use client";

import { useState, useTransition } from "react";
import { CheckCircle2 } from "lucide-react";
import { requestToJoin } from "@/app/join/actions";
import type { JoinInput } from "@/lib/referrals-core";
import { cn } from "@/lib/utils";

const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-base text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20";

const FIELDS: { key: keyof JoinInput; label: string; type?: string; placeholder?: string; autoComplete?: string; optional?: boolean }[] = [
  { key: "fullName", label: "Full name", autoComplete: "name" },
  { key: "email", label: "Email", type: "email", autoComplete: "email" },
  { key: "phone", label: "Mobile phone", type: "tel", autoComplete: "tel", optional: true },
  { key: "states", label: "States you're licensed in", placeholder: "e.g. IL, FL, TX", optional: true },
];

export function JoinForm({ slug, referrerFirstName }: { slug: string; referrerFirstName: string }) {
  const [values, setValues] = useState<JoinInput>({ fullName: "", email: "", phone: "", states: "", note: "" });
  const [website, setWebsite] = useState("");
  const [errors, setErrors] = useState<Partial<Record<keyof JoinInput, string>>>({});
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const set = (k: keyof JoinInput) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setValues((v) => ({ ...v, [k]: e.target.value }));
    if (errors[k]) setErrors((x) => ({ ...x, [k]: undefined }));
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    start(async () => {
      setError(null);
      try {
        const r = await requestToJoin(slug, { ...values, website });
        if (r.ok) setSentTo(r.name || values.fullName.split(" ")[0]);
        else {
          setErrors(r.errors ?? {});
          setError(r.error ?? null);
        }
      } catch {
        setError("That didn't send. Check your connection and try again.");
      }
    });
  };

  if (sentTo !== null)
    return (
      <div className="rounded-xl bg-blue-50 p-5 text-center ring-1 ring-blue-100">
        <CheckCircle2 className="mx-auto size-8 text-blue-700" />
        <p className="mt-2 font-semibold">Thanks{sentTo ? `, ${sentTo}` : ""}. Your request is in.</p>
        <p className="mt-1 text-sm text-slate-600">
          Anryh Labs will reach out at {values.email} once your account is ready, usually within a day. You&apos;ll be linked to {referrerFirstName}.
        </p>
      </div>
    );

  return (
    <form onSubmit={submit} noValidate className="space-y-3.5">
      {FIELDS.map((f) => (
        <div key={f.key}>
          <label htmlFor={`join-${f.key}`} className="mb-1 block text-sm font-medium text-slate-700">
            {f.label} {f.optional && <span className="font-normal text-slate-400">(optional)</span>}
          </label>
          <input
            id={`join-${f.key}`}
            type={f.type ?? "text"}
            autoComplete={f.autoComplete}
            placeholder={f.placeholder}
            className={cn(inputClass, errors[f.key] && "border-red-500")}
            aria-invalid={!!errors[f.key]}
            value={values[f.key]}
            onChange={set(f.key)}
          />
          {errors[f.key] && <p className="mt-1 text-sm text-red-600">{errors[f.key]}</p>}
        </div>
      ))}
      <div>
        <label htmlFor="join-note" className="mb-1 block text-sm font-medium text-slate-700">
          Anything we should know <span className="font-normal text-slate-400">(optional)</span>
        </label>
        <textarea id="join-note" rows={3} className={inputClass} placeholder="What you sell, how you get clients today…" value={values.note} onChange={set("note")} />
      </div>
      {/* Hidden from people; bots fill it in */}
      <input type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden className="hidden" value={website} onChange={(e) => setWebsite(e.target.value)} />
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button
        type="submit"
        disabled={pending}
        className="h-12 w-full rounded-lg bg-blue-700 text-base font-semibold text-white transition-colors hover:bg-blue-800 disabled:opacity-60"
      >
        {pending ? "Sending…" : "Request my invite"}
      </button>
      <p className="text-center text-xs text-slate-400">Your details only go to Anryh Labs, to set up your account.</p>
    </form>
  );
}

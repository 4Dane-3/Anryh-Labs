"use client";

import { useState } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  GENDER_OPTIONS,
  INTAKE_HEADER,
  MARITAL_OPTIONS,
  YES_NO,
} from "@/lib/booking/constants";
import type { IntakeInput } from "@/lib/booking/validate";

const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-base text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20";

type Values = Record<keyof IntakeInput, string>;

const empty: Values = {
  date_of_birth: "",
  gender: "",
  marital_status: "",
  nicotine: "",
  existing_coverage: "",
  policy_description: "",
  goal: "",
  reason: "",
  budget: "",
  coverage_amount: "",
  best_time_to_reach: "",
  notes: "",
};

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-1.5 block text-sm font-medium text-slate-700">
        {label}
      </label>
      {children}
    </div>
  );
}

/** Pill-style radio group. With `allowOther`, an "Other" pill reveals a free-text input. */
function Choice({
  name,
  options,
  value,
  onChange,
  allowOther,
}: {
  name: string;
  options: readonly string[];
  value: string;
  onChange: (v: string) => void;
  allowOther?: boolean;
}) {
  const isOther = !!allowOther && value !== "" && !options.includes(value);
  const [otherOpen, setOtherOpen] = useState(isOther);

  const pill = (active: boolean) =>
    `rounded-full border px-4 py-2 text-sm font-medium transition-colors ${
      active
        ? "border-blue-700 bg-blue-700 text-white"
        : "border-slate-300 bg-white text-slate-700 hover:border-blue-400"
    }`;

  return (
    <div role="radiogroup" aria-label={name} className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {options.map((opt) => (
          <button
            key={opt}
            type="button"
            role="radio"
            aria-checked={value === opt}
            className={pill(value === opt && !otherOpen)}
            onClick={() => {
              setOtherOpen(false);
              onChange(value === opt ? "" : opt);
            }}
          >
            {opt}
          </button>
        ))}
        {allowOther && (
          <button
            type="button"
            role="radio"
            aria-checked={otherOpen}
            className={pill(otherOpen)}
            onClick={() => {
              setOtherOpen(!otherOpen);
              onChange("");
            }}
          >
            Other
          </button>
        )}
      </div>
      {otherOpen && (
        <input
          autoFocus
          className={inputClass}
          placeholder="Please describe"
          value={isOther ? value : ""}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </div>
  );
}

export function IntakeForm({
  token,
  agentFirstName,
  initial,
}: {
  token: string;
  agentFirstName: string;
  initial: Partial<Values> | null;
}) {
  const [values, setValues] = useState<Values>({ ...empty, ...initial });
  const [status, setStatus] = useState<"idle" | "saving" | "done">("idle");
  const [error, setError] = useState<string | null>(null);

  const set = (key: keyof Values) => (v: string) => setValues((s) => ({ ...s, [key]: v }));
  const text =
    (key: keyof Values) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      set(key)(e.target.value);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("saving");
    setError(null);
    try {
      const res = await fetch("/api/intake", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, ...values }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setStatus("done");
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : "Something went wrong. Please try again.");
      setStatus("idle");
    }
  }

  if (status === "done") {
    return (
      <div className="rounded-2xl bg-white p-8 text-center shadow-sm ring-1 ring-slate-200">
        <CheckCircle2 className="mx-auto size-10 text-green-600" />
        <h2 className="mt-3 text-xl font-bold">Thank you!</h2>
        <p className="mt-1 text-slate-600">
          {agentFirstName} will review your answers before your call.
        </p>
        <button
          type="button"
          onClick={() => setStatus("idle")}
          className="mt-4 text-sm text-slate-500 underline hover:text-slate-800"
        >
          Edit my answers
        </button>
      </div>
    );
  }

  return (
    <form
      onSubmit={submit}
      className="space-y-6 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200 sm:p-8"
    >
      <div>
        <h2 className="text-xl font-bold leading-snug sm:text-2xl">{INTAKE_HEADER}</h2>
        <p className="mt-1.5 text-sm text-slate-500">
          Every question is optional. Answer as much or as little as you like.
        </p>
      </div>

      <div className="grid gap-6 sm:grid-cols-2">
        <Field label="Date of birth" htmlFor="dob">
          <input
            id="dob"
            type="date"
            className={inputClass}
            max={new Date().toISOString().slice(0, 10)}
            value={values.date_of_birth}
            onChange={text("date_of_birth")}
          />
        </Field>
        <Field label="Nicotine use">
          <Choice name="Nicotine use" options={YES_NO} value={values.nicotine} onChange={set("nicotine")} />
        </Field>
      </div>

      <Field label="Gender">
        <Choice name="Gender" options={GENDER_OPTIONS} value={values.gender} onChange={set("gender")} allowOther />
      </Field>

      <Field label="Marital status">
        <Choice
          name="Marital status"
          options={MARITAL_OPTIONS}
          value={values.marital_status}
          onChange={set("marital_status")}
        />
      </Field>

      <Field label="Existing coverage / policy">
        <Choice
          name="Existing coverage"
          options={YES_NO}
          value={values.existing_coverage}
          onChange={set("existing_coverage")}
          allowOther
        />
      </Field>

      <Field label="Description of policy (Term, Whole Life, IUL, Final Expense)" htmlFor="policy">
        <input
          id="policy"
          className={inputClass}
          placeholder="e.g. 20-year term through work"
          value={values.policy_description}
          onChange={text("policy_description")}
        />
      </Field>

      <Field label="What is your goal with life insurance?" htmlFor="goal">
        <textarea id="goal" rows={2} className={inputClass} value={values.goal} onChange={text("goal")} />
      </Field>

      <Field label="What is the reason you inquired or have a current policy in place?" htmlFor="reason">
        <textarea id="reason" rows={2} className={inputClass} value={values.reason} onChange={text("reason")} />
      </Field>

      <div className="grid gap-6 sm:grid-cols-2">
        <Field label="How much do you pay for your policy, or how much can you afford?" htmlFor="budget">
          <input
            id="budget"
            className={inputClass}
            placeholder="e.g. $50/month"
            value={values.budget}
            onChange={text("budget")}
          />
        </Field>
        <Field label="How much coverage do you currently have or need?" htmlFor="coverage">
          <input
            id="coverage"
            className={inputClass}
            placeholder="e.g. $250,000"
            value={values.coverage_amount}
            onChange={text("coverage_amount")}
          />
        </Field>
      </div>

      <Field label="Best time to reach out to you" htmlFor="best-time">
        <input
          id="best-time"
          className={inputClass}
          placeholder="e.g. weekday evenings after 6pm"
          value={values.best_time_to_reach}
          onChange={text("best_time_to_reach")}
        />
      </Field>

      <Field label={`Extra notes for ${agentFirstName} to know before the appointment`} htmlFor="notes">
        <textarea id="notes" rows={3} className={inputClass} value={values.notes} onChange={text("notes")} />
      </Field>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <Button
        type="submit"
        size="lg"
        disabled={status === "saving"}
        className="h-12 w-full bg-blue-700 text-base hover:bg-blue-800"
      >
        {status === "saving" ? <Loader2 className="size-4 animate-spin" /> : `Send to ${agentFirstName}`}
      </Button>
    </form>
  );
}

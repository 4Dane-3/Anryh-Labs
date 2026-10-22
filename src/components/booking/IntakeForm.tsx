"use client";

import { useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ArrowLeft, CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { INTAKE_HEADER } from "@/lib/booking/constants";
import {
  activeSteps,
  isHidden,
  STEP_TITLES,
  type IntakeQuestion,
} from "@/lib/booking/questions";

const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-base text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20";

/** Pill-style radio group. With `allowOther`, an "Other" pill reveals a free-text input. */
function Choice({
  label,
  options,
  value,
  onChange,
  allowOther,
}: {
  label: string;
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
    <div role="radiogroup" aria-label={label} className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {options.map((opt) => (
          <button
            key={opt}
            type="button"
            role="radio"
            aria-checked={value === opt && !otherOpen}
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

export function QuestionField({
  question,
  value,
  onChange,
  required = false,
}: {
  question: IntakeQuestion;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
}) {
  const id = `q-${question.key}`;
  const placeholder = question.placeholder ?? undefined;

  let control: React.ReactNode;
  if (question.kind === "choice") {
    control = (
      <Choice
        label={question.label}
        options={question.options}
        value={value}
        onChange={onChange}
        allowOther={question.allow_other}
      />
    );
  } else if (question.kind === "date") {
    control = (
      <input
        id={id}
        type="date"
        className={inputClass}
        max={question.key === "date_of_birth" ? new Date().toISOString().slice(0, 10) : undefined}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  } else if (question.kind === "long_text") {
    control = (
      <textarea
        id={id}
        rows={3}
        className={inputClass}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  } else {
    control = (
      <input
        id={id}
        className={inputClass}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }

  return (
    <div>
      <label
        htmlFor={question.kind === "choice" ? undefined : id}
        className="mb-1.5 block text-sm font-medium text-slate-700"
      >
        {question.label}
        {required && (
          <span className="ml-1 text-red-600" aria-hidden="true">
            *
          </span>
        )}
        {required && <span className="sr-only"> (required)</span>}
      </label>
      {control}
    </div>
  );
}

export function IntakeForm({
  token,
  agentFirstName,
  questions,
  initial,
  completed,
  answeredAtBooking = [],
}: {
  token: string;
  agentFirstName: string;
  questions: IntakeQuestion[];
  initial: Record<string, string>;
  completed: boolean;
  /** Required questions they answered before booking: kept in the saved answers, not asked again. */
  answeredAtBooking?: string[];
}) {
  const reduceMotion = useReducedMotion();
  const shown = questions.filter((q) => !answeredAtBooking.includes(q.key));
  const steps = activeSteps(shown);
  const [values, setValues] = useState<Record<string, string>>(initial);
  const [index, setIndex] = useState(0);
  const [dir, setDir] = useState(1);
  const [status, setStatus] = useState<"idle" | "saving" | "done">(
    completed || steps.length === 0 ? "done" : "idle",
  );
  const [error, setError] = useState<string | null>(null);

  const step = steps[index];
  const isLast = index === steps.length - 1;
  const stepQuestions = shown
    .filter((q) => q.step === step && !isHidden(q, values))
    .sort((a, b) => a.sort - b.sort);

  async function save(final: boolean) {
    // Only send answers to questions that are visible given the other answers
    const answers = Object.fromEntries(
      questions.filter((q) => !isHidden(q, values)).map((q) => [q.key, values[q.key] ?? ""]),
    );
    const res = await fetch("/api/intake", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, final, answers }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
  }

  function go(next: number) {
    setDir(next > index ? 1 : -1);
    setIndex(next);
    setError(null);
    if (window.scrollY > 0) window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();

    if (!isLast) {
      // Autosave in the background so answers survive if they leave mid-way
      save(false).catch(() => {});
      go(index + 1);
      return;
    }

    setStatus("saving");
    setError(null);
    try {
      await save(true);
      setStatus("done");
    } catch (err) {
      setError(
        err instanceof Error && err.message ? err.message : "Something went wrong. Please try again.",
      );
      setStatus("idle");
    }
  }

  // Next swipes everything to the right (new step comes in from the left); Back swipes it back
  const swipe = reduceMotion ? "0%" : "100%";
  const back = reduceMotion ? "0%" : "-100%";
  const variants = {
    enter: (d: number) => ({ opacity: 0, x: d > 0 ? back : swipe }),
    center: { opacity: 1, x: "0%" },
    exit: (d: number) => ({ opacity: 0, x: d > 0 ? swipe : back }),
  };

  if (status === "done") {
    return (
      <motion.div
        initial={{ opacity: 0, scale: reduceMotion ? 1 : 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.35, ease: "easeOut" }}
        className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-6 text-center"
      >
        <CheckCircle2 className="size-14 text-green-600" />
        <h2 className="mt-4 text-3xl font-bold tracking-tight">Thank you!</h2>
        <p className="mt-2 text-lg text-slate-600">
          {agentFirstName} will review your answers before your call.
        </p>
        {steps.length > 0 && (
          <button
            type="button"
            onClick={() => {
              setIndex(0);
              setDir(-1);
              setStatus("idle");
            }}
            className="mt-4 text-sm text-slate-500 underline hover:text-slate-800"
          >
            Edit my answers
          </button>
        )}
      </motion.div>
    );
  }

  return (
    <form
      onSubmit={submit}
      className="mx-auto flex min-h-screen w-full max-w-xl flex-col px-5 pt-20 sm:px-6 sm:pt-28"
    >
      <h1 className="text-2xl font-bold leading-tight tracking-tight sm:text-4xl">{INTAKE_HEADER}</h1>
      <p className="mt-2 text-slate-500">
        Every question is optional. Answer as much or as little as you like.
      </p>

      <div className="mt-8">
        <div className="flex gap-1.5" aria-hidden="true">
          {steps.map((s, i) => (
            <div key={s} className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-200">
              <motion.div
                className="h-full rounded-full bg-blue-700"
                initial={false}
                animate={{ width: i <= index ? "100%" : "0%" }}
                transition={{ duration: reduceMotion ? 0 : 0.35, ease: "easeOut" }}
              />
            </div>
          ))}
        </div>
        <p className="mt-2 text-xs font-medium text-slate-500" aria-live="polite">
          Step {index + 1} of {steps.length} · {STEP_TITLES[step - 1]}
        </p>
      </div>

      {/* Clip the swipe to the column; padding keeps focus rings from being cut off */}
      <div className="relative -mx-2 mt-8 flex-1 overflow-hidden px-2 pb-2">
        <AnimatePresence mode="popLayout" custom={dir} initial={false}>
          <motion.div
            key={step}
            custom={dir}
            variants={variants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{
              x: { type: "tween", duration: 0.32, ease: [0.32, 0.72, 0, 1] },
              opacity: { duration: 0.2 },
            }}
            className="space-y-6"
          >
            {stepQuestions.map((q) => (
              <QuestionField
                key={q.key}
                question={q}
                value={values[q.key] ?? ""}
                onChange={(v) => setValues((s) => ({ ...s, [q.key]: v }))}
              />
            ))}
          </motion.div>
        </AnimatePresence>
      </div>

      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

      <div className="sticky bottom-0 -mx-5 mt-6 flex items-center gap-3 bg-linear-to-t from-white from-75% to-white/0 px-5 pb-6 pt-8 sm:-mx-6 sm:px-6 sm:pb-10">
        {index > 0 && (
          <Button
            type="button"
            variant="ghost"
            size="lg"
            onClick={() => go(index - 1)}
            className="h-12 text-slate-600"
          >
            <ArrowLeft className="size-4" /> Back
          </Button>
        )}
        <Button
          type="submit"
          size="lg"
          disabled={status === "saving"}
          className="h-12 flex-1 bg-blue-700 text-base hover:bg-blue-800"
        >
          {status === "saving" ? (
            <Loader2 className="size-4 animate-spin" />
          ) : isLast ? (
            `Send to ${agentFirstName}`
          ) : (
            "Next"
          )}
        </Button>
      </div>
    </form>
  );
}

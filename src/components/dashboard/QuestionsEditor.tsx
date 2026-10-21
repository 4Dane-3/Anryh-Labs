"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, Reorder, motion, useDragControls } from "framer-motion";
import { ChevronDown, ChevronUp, GripVertical, Plus, Trash2, X } from "lucide-react";
import { resetQuestions, saveQuestions } from "@/app/dashboard/actions";
import {
  KIND_LABELS,
  STEP_TITLES,
  type IntakeQuestion,
  type QuestionKind,
} from "@/lib/booking/questions";
import { Badge, Button, Label, Panel, Switch, inputClass } from "@/components/dashboard/ui";
import { cn } from "@/lib/utils";

const newKey = () => `custom_${Math.random().toString(36).slice(2, 8)}`;

function OptionsEditor({
  options,
  onChange,
}: {
  options: string[];
  onChange: (o: string[]) => void;
}) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const v = draft.trim();
    if (v && !options.includes(v)) onChange([...options, v]);
    setDraft("");
  };
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <AnimatePresence initial={false}>
        {options.map((o) => (
          <motion.span
            key={o}
            layout
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            className="inline-flex items-center gap-1 rounded-full border border-line bg-ink-high py-1 pl-3 pr-1 text-[13px]"
          >
            {o}
            <button
              type="button"
              aria-label={`Remove ${o}`}
              onClick={() => onChange(options.filter((x) => x !== o))}
              className="rounded-full p-0.5 text-fg-faint hover:text-fg"
            >
              <X className="size-3" />
            </button>
          </motion.span>
        ))}
      </AnimatePresence>
      <input
        className="w-32 rounded-full border border-dashed border-line-strong bg-transparent px-3 py-1 text-[13px] placeholder:text-fg-faint focus:border-brand/60 focus:outline-none"
        placeholder="Add a choice"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            add();
          }
        }}
        onBlur={add}
      />
    </div>
  );
}

function QuestionCard({
  question,
  all,
  open,
  onToggle,
  onChange,
  onDelete,
  onMove,
  canUp,
  canDown,
}: {
  question: IntakeQuestion;
  all: IntakeQuestion[];
  open: boolean;
  onToggle: () => void;
  onChange: (q: IntakeQuestion) => void;
  onDelete: () => void;
  onMove: (dir: -1 | 1) => void;
  canUp: boolean;
  canDown: boolean;
}) {
  const drag = useDragControls();
  const set = <K extends keyof IntakeQuestion>(k: K, v: IntakeQuestion[K]) => onChange({ ...question, [k]: v });
  const choiceQuestions = all.filter((q) => q.kind === "choice" && q.key !== question.key && q.options.length);
  const conditionTarget = all.find((q) => q.key === question.hidden_when_key);

  return (
    <Reorder.Item
      value={question}
      dragListener={false}
      dragControls={drag}
      className={cn(
        "rounded-lg border bg-ink-raised",
        open ? "border-line-strong" : "border-line",
        !question.enabled && "opacity-55",
      )}
    >
      <div className="flex items-center gap-2 px-2 py-2">
        <button
          type="button"
          aria-label="Drag to reorder"
          onPointerDown={(e) => drag.start(e)}
          className="cursor-grab touch-none rounded p-1 text-fg-faint hover:text-fg active:cursor-grabbing"
        >
          <GripVertical className="size-4" />
        </button>
        <button type="button" onClick={onToggle} className="min-w-0 flex-1 py-1 text-left">
          <p className="truncate text-sm">{question.label || <span className="text-fg-faint">Untitled question</span>}</p>
          <p className="mt-0.5 flex items-center gap-2 text-[12px] text-fg-faint">
            {KIND_LABELS[question.kind]}
            {question.kind === "choice" && ` · ${question.options.join(", ")}`}
            {conditionTarget && (
              <Badge className="ml-1">Hidden if {conditionTarget.label.slice(0, 24)} = {question.hidden_when_value}</Badge>
            )}
          </p>
        </button>
        <div className="flex items-center">
          <button
            type="button"
            aria-label="Move up"
            disabled={!canUp}
            onClick={() => onMove(-1)}
            className="rounded p-1 text-fg-faint hover:text-fg disabled:opacity-30"
          >
            <ChevronUp className="size-4" />
          </button>
          <button
            type="button"
            aria-label="Move down"
            disabled={!canDown}
            onClick={() => onMove(1)}
            className="rounded p-1 text-fg-faint hover:text-fg disabled:opacity-30"
          >
            <ChevronDown className="size-4" />
          </button>
        </div>
        <Switch label={question.enabled ? "Asking this question" : "Not asking this question"} checked={question.enabled} onChange={(v) => set("enabled", v)} />
      </div>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="space-y-4 border-t border-line px-4 py-4">
              <div>
                <Label htmlFor={`label-${question.key}`}>Question</Label>
                <input
                  id={`label-${question.key}`}
                  className={inputClass}
                  value={question.label}
                  maxLength={200}
                  onChange={(e) => set("label", e.target.value)}
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <Label htmlFor={`kind-${question.key}`}>Answer type</Label>
                  <select
                    id={`kind-${question.key}`}
                    className={inputClass}
                    value={question.kind}
                    onChange={(e) => {
                      const kind = e.target.value as QuestionKind;
                      onChange({
                        ...question,
                        kind,
                        options: kind === "choice" && !question.options.length ? ["Yes", "No"] : question.options,
                      });
                    }}
                  >
                    {(Object.keys(KIND_LABELS) as QuestionKind[]).map((k) => (
                      <option key={k} value={k}>
                        {KIND_LABELS[k]}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <Label htmlFor={`step-${question.key}`}>Step</Label>
                  <select
                    id={`step-${question.key}`}
                    className={inputClass}
                    value={question.step}
                    onChange={(e) => set("step", Number(e.target.value))}
                  >
                    {STEP_TITLES.map((t, i) => (
                      <option key={t} value={i + 1}>
                        {i + 1}. {t}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {question.kind === "choice" && (
                <div>
                  <Label>Choices</Label>
                  <OptionsEditor options={question.options} onChange={(o) => set("options", o)} />
                  <label className="mt-3 flex items-center gap-2 text-[13px] text-fg-muted">
                    <Switch label='Allow an "Other" answer' checked={question.allow_other} onChange={(v) => set("allow_other", v)} />
                    Let people type their own answer (&ldquo;Other&rdquo;)
                  </label>
                </div>
              )}

              {(question.kind === "short_text" || question.kind === "long_text") && (
                <div>
                  <Label htmlFor={`ph-${question.key}`}>Example answer (shown greyed out)</Label>
                  <input
                    id={`ph-${question.key}`}
                    className={inputClass}
                    maxLength={120}
                    value={question.placeholder ?? ""}
                    onChange={(e) => set("placeholder", e.target.value || null)}
                  />
                </div>
              )}

              {choiceQuestions.length > 0 && (
                <div>
                  <Label>Hide this question when…</Label>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <select
                      aria-label="Depends on question"
                      className={inputClass}
                      value={question.hidden_when_key ?? ""}
                      onChange={(e) => {
                        const target = all.find((q) => q.key === e.target.value);
                        onChange({
                          ...question,
                          hidden_when_key: target?.key ?? null,
                          hidden_when_value: target?.options[0] ?? null,
                        });
                      }}
                    >
                      <option value="">Always show it</option>
                      {choiceQuestions.map((q) => (
                        <option key={q.key} value={q.key}>
                          {q.label}
                        </option>
                      ))}
                    </select>
                    {conditionTarget && (
                      <select
                        aria-label="Answer that hides this question"
                        className={`${inputClass} sm:w-40`}
                        value={question.hidden_when_value ?? ""}
                        onChange={(e) => set("hidden_when_value", e.target.value)}
                      >
                        {conditionTarget.options.map((o) => (
                          <option key={o} value={o}>
                            is &ldquo;{o}&rdquo;
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                </div>
              )}

              <Button variant="danger" size="sm" className="-ml-3" onClick={onDelete}>
                <Trash2 /> Delete question
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </Reorder.Item>
  );
}

export function QuestionsEditor({ initial, usingDefaults }: { initial: IntakeQuestion[]; usingDefaults: boolean }) {
  const router = useRouter();
  const [questions, setQuestions] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [pending, startTransition] = useTransition();

  const dirty = JSON.stringify(questions) !== JSON.stringify(saved);
  const byStep = (step: number) => questions.filter((q) => q.step === step);

  const replace = (key: string, next: IntakeQuestion) =>
    setQuestions((qs) => {
      const updated = qs.map((q) => (q.key === key ? next : q));
      // Moving to another step puts the question at the end of that step
      if (next.step !== qs.find((q) => q.key === key)?.step) {
        return [...updated.filter((q) => q.key !== key), next];
      }
      return updated;
    });

  const reorderStep = (step: number, order: IntakeQuestion[]) =>
    setQuestions((qs) => {
      const result: IntakeQuestion[] = [];
      for (let s = 1; s <= 4; s++) result.push(...(s === step ? order : qs.filter((q) => q.step === s)));
      return result;
    });

  const move = (step: number, key: string, dir: -1 | 1) => {
    const list = byStep(step);
    const i = list.findIndex((q) => q.key === key);
    const j = i + dir;
    if (j < 0 || j >= list.length) return;
    const copy = [...list];
    [copy[i], copy[j]] = [copy[j], copy[i]];
    reorderStep(step, copy);
  };

  const add = (step: number) => {
    const q: IntakeQuestion = {
      key: newKey(),
      step,
      sort: 0,
      label: "",
      kind: "short_text",
      options: [],
      allow_other: false,
      placeholder: null,
      hidden_when_key: null,
      hidden_when_value: null,
      enabled: true,
    };
    reorderStep(step, [...byStep(step), q]);
    setOpenKey(q.key);
  };

  const remove = (key: string) =>
    setQuestions((qs) =>
      qs
        .filter((q) => q.key !== key)
        .map((q) => (q.hidden_when_key === key ? { ...q, hidden_when_key: null, hidden_when_value: null } : q)),
    );

  const save = () =>
    startTransition(async () => {
      setError(null);
      const res = await saveQuestions(questions);
      if (!res.ok) return setError(res.error);
      setSaved(questions);
      router.refresh();
    });

  const reset = () =>
    startTransition(async () => {
      const res = await resetQuestions();
      if (!res.ok) return setError(res.error);
      setConfirmReset(false);
      router.refresh();
      // The server now returns the defaults; reload to pick them up cleanly
      window.location.reload();
    });

  return (
    <div className="pb-24">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <p className="text-[13px] text-fg-muted">
          {usingDefaults && !dirty ? "You're using the standard questions. " : ""}
          Turn a question off to stop asking it without deleting it.
        </p>
        {confirmReset ? (
          <div className="flex items-center gap-2 text-[13px]">
            <span className="text-fg-muted">Replace all your questions with the standard set?</span>
            <Button size="sm" variant="ghost" onClick={() => setConfirmReset(false)}>
              No
            </Button>
            <Button size="sm" variant="danger" onClick={reset} disabled={pending}>
              Reset
            </Button>
          </div>
        ) : (
          !usingDefaults && (
            <Button size="sm" variant="ghost" onClick={() => setConfirmReset(true)}>
              Reset to standard questions
            </Button>
          )
        )}
      </div>

      <div className="space-y-8">
        {STEP_TITLES.map((title, i) => {
          const step = i + 1;
          const list = byStep(step);
          return (
            <section key={title}>
              <div className="mb-3 flex items-baseline justify-between">
                <h2 className="text-sm font-semibold">
                  <span className="mr-2 text-fg-faint">Step {step}</span>
                  {title}
                </h2>
                {list.every((q) => !q.enabled) && <span className="text-[12px] text-fg-faint">Skipped. Nothing to ask</span>}
              </div>
              <Reorder.Group axis="y" values={list} onReorder={(order) => reorderStep(step, order)} className="space-y-2">
                {list.map((q, idx) => (
                  <QuestionCard
                    key={q.key}
                    question={q}
                    all={questions}
                    open={openKey === q.key}
                    onToggle={() => setOpenKey(openKey === q.key ? null : q.key)}
                    onChange={(next) => replace(q.key, next)}
                    onDelete={() => remove(q.key)}
                    onMove={(dir) => move(step, q.key, dir)}
                    canUp={idx > 0}
                    canDown={idx < list.length - 1}
                  />
                ))}
              </Reorder.Group>
              <button
                type="button"
                onClick={() => add(step)}
                className="mt-2 inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[13px] text-fg-muted transition-colors hover:bg-white/[0.04] hover:text-fg"
              >
                <Plus className="size-3.5" /> Add a question
              </button>
            </section>
          );
        })}
      </div>

      <AnimatePresence>
        {(dirty || error) && (
          <motion.div
            initial={{ y: 80, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 80, opacity: 0 }}
            transition={{ type: "spring", stiffness: 420, damping: 36 }}
            className="fixed inset-x-0 bottom-4 z-30 flex justify-center px-4 lg:pl-60"
          >
            <Panel className="flex w-full max-w-xl items-center gap-3 px-4 py-3 shadow-2xl">
              <p className={cn("flex-1 text-[13px]", error ? "text-bad" : "text-fg-muted")}>
                {error ?? "You have unsaved changes."}
              </p>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setQuestions(saved);
                  setError(null);
                }}
              >
                Discard
              </Button>
              <Button size="sm" variant="primary" onClick={save} disabled={pending}>
                {pending ? "Saving…" : "Save questions"}
              </Button>
            </Panel>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

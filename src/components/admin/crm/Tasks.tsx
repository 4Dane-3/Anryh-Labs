"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { DateTime } from "luxon";
import { Phone, Trash2 } from "lucide-react";
import { addTask, deleteTask, setTaskDone } from "@/app/admin/crm/actions";
import { clientLabel, dayIn, meetingPhase, type CalendarMeeting, type ClientRef, type CrmTask, type DueTask } from "@/lib/crm/types";
import { Button, EmptyState, inputClass, Panel, PanelHeader } from "@/components/dashboard/ui";
import { dueLabel, MeetingBadge } from "@/components/admin/crm/shared";
import { OutcomeDialog } from "@/components/admin/crm/OutcomeDialog";
import { cn } from "@/lib/utils";

function TaskRow({ task, today, client }: { task: CrmTask; today: string; client?: ClientRef }) {
  const router = useRouter();
  const [done, setDone] = useState(!!task.done_at);
  const [pending, start] = useTransition();
  const overdue = !done && task.due_on < today;
  return (
    <li className={cn("group flex items-center gap-3 px-5 py-2.5", pending && "opacity-60")}>
      <input
        type="checkbox"
        aria-label={`Done: ${task.title}`}
        checked={done}
        onChange={(e) => {
          const next = e.target.checked;
          setDone(next);
          start(async () => {
            const r = await setTaskDone(task.id, next);
            if (!r.ok) setDone(!next);
            else router.refresh();
          });
        }}
        className="size-4 shrink-0 accent-[var(--color-brand)]"
      />
      <div className="min-w-0 flex-1">
        <p className={cn("truncate text-[13px]", done ? "text-fg-faint line-through" : "text-fg")}>{task.title}</p>
        {client && (
          <Link href={`/admin/clients/${client.id}`} className="text-[12px] text-fg-muted hover:text-brand">
            {clientLabel(client)}
          </Link>
        )}
      </div>
      <span className={cn("shrink-0 font-mono text-[11px]", overdue ? "text-bad" : "text-fg-faint")}>{dueLabel(task.due_on, today)}</span>
      <button
        aria-label={`Delete task: ${task.title}`}
        className="rounded p-1 text-fg-faint opacity-0 hover:bg-white/[0.06] hover:text-bad group-hover:opacity-100"
        onClick={() => {
          if (!confirm("Delete this task?")) return;
          start(async () => {
            await deleteTask(task.id);
            router.refresh();
          });
        }}
      >
        <Trash2 className="size-3.5" />
      </button>
    </li>
  );
}

/** The client page's tasks: add a next step with a due date, tick them off. */
export function ClientTasks({ clientId, tasks, timezone }: { clientId: string; tasks: CrmTask[]; timezone: string }) {
  const router = useRouter();
  const [now] = useState(() => Date.now());
  const today = dayIn(timezone, now);
  const [title, setTitle] = useState("");
  const [due, setDue] = useState(today);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const open = tasks.filter((t) => !t.done_at);
  const done = tasks.filter((t) => t.done_at).slice(0, 10);
  const add = () =>
    start(async () => {
      setError(null);
      const r = await addTask({ clientId, title, dueOn: due });
      if (!r.ok) return setError(r.error);
      setTitle("");
      router.refresh();
    });
  return (
    <Panel>
      <PanelHeader title="Tasks" description="Next steps with a due date. Due and overdue ones show at the top of Clients." />
      <form
        className="flex flex-wrap items-center gap-2 border-b border-line px-5 py-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (title.trim()) add();
        }}
      >
        <input aria-label="New task" className={cn(inputClass, "min-w-0 flex-1")} placeholder="Call back, send proposal…" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
        <input aria-label="Due date" type="date" className={cn(inputClass, "w-auto [color-scheme:dark]")} value={due} min={today} onChange={(e) => setDue(e.target.value)} />
        <Button type="submit" size="sm" variant="primary" disabled={pending || !title.trim()}>
          Add
        </Button>
        {error && <p className="w-full text-[13px] text-bad">{error}</p>}
      </form>
      {open.length === 0 && done.length === 0 ? (
        <EmptyState title="No tasks yet" />
      ) : (
        <ul className="divide-y divide-line">
          {open.map((t) => (
            <TaskRow key={t.id} task={t} today={today} />
          ))}
          {done.map((t) => (
            <TaskRow key={t.id} task={t} today={today} />
          ))}
        </ul>
      )}
    </Panel>
  );
}

/**
 * The top of the CRM: tasks due today or overdue, meetings today that are still unconfirmed ("call to
 * confirm"), and meetings that have happened but still need an outcome.
 */
export function DueToday({ tasks, meetings, timezone }: { tasks: DueTask[]; meetings: CalendarMeeting[]; timezone: string }) {
  const [now] = useState(() => Date.now());
  const [outcomeFor, setOutcomeFor] = useState<CalendarMeeting | null>(null);
  const today = dayIn(timezone, now);
  const flagged = meetings.map((m) => ({ m, phase: meetingPhase(m, now, timezone) })).filter((x) => x.phase === "call" || x.phase === "needs_outcome");
  const count = tasks.length + flagged.length;
  if (count === 0) return null;
  return (
    <Panel>
      <PanelHeader title={`Due today · ${count}`} description="Tasks due today or overdue, unconfirmed meetings today, and meetings to mark." />
      <ul className="divide-y divide-line">
        {flagged.map(({ m, phase }) => {
          const s = DateTime.fromISO(m.starts_at).setZone(timezone);
          return (
            <li key={m.id} className="flex items-center gap-3 px-5 py-2.5">
              <Phone className={cn("size-4 shrink-0", phase === "call" ? "text-bad" : "text-fg-faint")} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] text-fg">
                  {phase === "call" ? `Call to confirm: ${m.title}` : `Mark what happened: ${m.title}`}
                  <span className="text-fg-muted"> · {s.toFormat(phase === "call" ? "h:mm a" : "ccc LLL d, h:mm a")}</span>
                </p>
                <Link href={`/admin/clients/${m.client.id}`} className="text-[12px] text-fg-muted hover:text-brand">
                  {clientLabel(m.client)}
                </Link>
              </div>
              {phase === "needs_outcome" ? (
                <Button size="sm" variant="ghost" onClick={() => setOutcomeFor(m)}>
                  Mark what happened
                </Button>
              ) : (
                <MeetingBadge meeting={m} timezone={timezone} now={now} />
              )}
            </li>
          );
        })}
        {tasks.map((t) => (
          <TaskRow key={t.id} task={t} today={today} client={t.client} />
        ))}
      </ul>
      {outcomeFor && <OutcomeDialog open meetingId={outcomeFor.id} label={clientLabel(outcomeFor.client)} onClose={() => setOutcomeFor(null)} />}
    </Panel>
  );
}

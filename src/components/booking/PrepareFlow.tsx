"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import {
  AnimatePresence,
  LayoutGroup,
  motion,
  useReducedMotion,
} from "framer-motion";
import { CalendarPlus, Check } from "lucide-react";
import { IntakeForm } from "@/components/booking/IntakeForm";
import type { IntakeQuestion } from "@/lib/booking/questions";

const noopSubscribe = () => () => {};

/**
 * On arrival from a fresh booking, the "You're booked" card zooms out in the middle of the screen,
 * holds for a beat, then swishes into a compact pill in the top-right corner (shared layoutId).
 * Then the intake form fades in underneath.
 */
export function PrepareFlow({
  token,
  agentName,
  startsAt,
  questions,
  initial,
  completed,
  justBooked,
}: {
  token: string;
  agentName: string;
  startsAt: string;
  questions: IntakeQuestion[];
  initial: Record<string, string>;
  completed: boolean;
  justBooked: boolean;
}) {
  const reduceMotion = useReducedMotion();
  const [phase, setPhase] = useState<"intro" | "settled">(justBooked ? "intro" : "settled");
  // Times render in the visitor's timezone, so they only exist on the client
  const isClient = useSyncExternalStore(noopSubscribe, () => true, () => false);

  useEffect(() => {
    if (phase !== "intro") return;
    const timer = setTimeout(
      () => {
        setPhase("settled");
        // Drop ?new=1 so a refresh doesn't replay the intro
        window.history.replaceState(null, "", `${window.location.pathname}?b=${token}`);
      },
      reduceMotion ? 0 : 1700,
    );
    return () => clearTimeout(timer);
  }, [phase, reduceMotion, token]);

  const date = new Date(startsAt);
  const longWhen = isClient
    ? `${date.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })} at ${date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", timeZoneName: "short" })}`
    : " ";
  const shortWhen = isClient
    ? `${date.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })} · ${date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`
    : " ";

  const swish = { type: "spring" as const, stiffness: 260, damping: 28 };

  return (
    <LayoutGroup>
      <AnimatePresence>
        {phase === "intro" && (
          <motion.div
            key="intro"
            className="fixed inset-0 z-50 flex items-center justify-center bg-white px-6"
            exit={{ backgroundColor: "rgba(255, 255, 255, 0)" }}
            transition={{ duration: 0.4 }}
          >
            <motion.div
              layoutId="booked"
              initial={{ scale: 0.4, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ ...swish, opacity: { duration: 0.25 } }}
              className="w-full max-w-sm rounded-3xl bg-white p-8 text-center shadow-xl ring-1 ring-black/5"
            >
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: "spring", stiffness: 400, damping: 15, delay: 0.2 }}
                className="mx-auto flex size-16 items-center justify-center rounded-full bg-green-600 text-white"
              >
                <Check className="size-9" strokeWidth={3} />
              </motion.div>
              <h1 className="mt-5 text-2xl font-bold">You&apos;re booked!</h1>
              <p className="mt-1 text-slate-500">with {agentName}</p>
              <p className="mt-4 font-medium text-slate-800">{longWhen}</p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {phase === "settled" && (
        <motion.div
          layoutId="booked"
          initial={justBooked ? false : { opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={swish}
          className="fixed right-3 top-3 z-40 flex items-center gap-2 rounded-full bg-white py-1.5 pl-2 pr-1.5 text-sm shadow-md ring-1 ring-black/5 sm:right-5 sm:top-5"
        >
          <span className="flex size-6 items-center justify-center rounded-full bg-green-600 text-white">
            <Check className="size-3.5" strokeWidth={3} />
          </span>
          <span className="whitespace-nowrap font-medium text-slate-800">
            <span className="hidden sm:inline">Booked · </span>
            {shortWhen}
          </span>
          <a
            href={`/api/bookings/ics?token=${token}`}
            aria-label="Add to my calendar"
            title="Add to my calendar"
            className="flex size-7 items-center justify-center rounded-full text-blue-700 hover:bg-blue-50"
          >
            <CalendarPlus className="size-4" />
          </a>
        </motion.div>
      )}

      {phase === "settled" && (
        // Opacity only: the form is full-height, so a y-offset would flash a scrollbar and nudge the pill
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.4, ease: "easeOut", delay: justBooked ? 0.3 : 0 }}
        >
          <IntakeForm
            token={token}
            agentFirstName={agentName.split(" ")[0]}
            questions={questions}
            initial={initial}
            completed={completed}
          />
        </motion.div>
      )}
    </LayoutGroup>
  );
}

"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Globe, Loader2, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CONSENT_TEXT } from "@/lib/booking/constants";
import { startTracking, track, trackOnce } from "@/lib/booking/track";
import { QuestionField } from "@/components/booking/IntakeForm";
import {
  isHidden,
  isRequired,
  missingRequired,
  STEP_TITLES,
  type IntakeQuestion,
} from "@/lib/booking/questions";

const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-base text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20";

function dayKey(iso: string, tz: string) {
  // en-CA formats as YYYY-MM-DD
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

function collectAttribution() {
  const out: Record<string, string> = {};
  const params = new URLSearchParams(window.location.search);
  for (const [key, value] of params) {
    if (key.startsWith("utm_") || key === "fbclid") out[key] = value;
  }
  for (const cookie of document.cookie.split("; ")) {
    const [name, ...rest] = cookie.split("=");
    if (name === "_fbp" || name === "_fbc") out[name] = rest.join("=");
  }
  return out;
}

export function BookingWidget({
  slug,
  firstName,
  preview = false,
  questions = [],
  requiredSteps = [],
}: {
  slug: string;
  firstName: string;
  preview?: boolean;
  /** The agent's required questions (and what they depend on), asked before the booking is confirmed. */
  questions?: IntakeQuestion[];
  requiredSteps?: number[];
}) {
  const router = useRouter();
  // Visitor's timezone; empty during SSR so server and client markup match
  const tz = useSyncExternalStore(
    () => () => {},
    () => Intl.DateTimeFormat().resolvedOptions().timeZone,
    () => "",
  );
  const [nowMs] = useState(() => Date.now()); // for "Today" / "Tomorrow" labels
  const [slots, setSlots] = useState<string[] | null>(null);
  // Times inside the agent's hours that are already booked (or held back): shown greyed out
  const [taken, setTaken] = useState<string[]>([]);
  const [slotMinutes, setSlotMinutes] = useState(30);
  const [day, setDay] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: "",
    email: "",
    phone: "",
    company: "", // honeypot
    consent: false,
  });
  // 0 = contact details; then one page per step that has required questions
  const [page, setPage] = useState(0);
  const [values, setValues] = useState<Record<string, string>>({});
  const questionSteps = [...new Set(questions.map((q) => q.step))];
  const step = questionSteps[page - 1];
  const pageQuestions = questions.filter((q) => q.step === step && !isHidden(q, values));
  const isLastPage = page === questionSteps.length;

  async function loadSlots() {
    try {
      const res = await fetch(`/api/agents/${slug}/slots`, { cache: "no-store" });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setSlots(data.slots);
      setTaken(Array.isArray(data.taken) ? data.taken : []);
      setSlotMinutes(data.slotMinutes);
    } catch {
      setSlots([]);
      setError("Couldn't load times. Please refresh and try again.");
    }
  }

  useEffect(() => {
    // State is only set once the fetch resolves, never synchronously in the effect
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadSlots();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  // Count one visit per browser session, tagged with the ad that sent it; then follow the visit's steps
  useEffect(() => {
    if (preview) return;
    startTracking(slug);
    try {
      const key = `visit:${slug}`;
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, "1");
    } catch {
      // storage blocked: still count the visit
    }
    const params = new URLSearchParams(window.location.search);
    fetch(`/api/agents/${slug}/visit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ utm_source: params.get("utm_source"), utm_content: params.get("utm_content") }),
      keepalive: true,
    }).catch(() => {});
  }, [slug, preview]);

  // "Saw the times": the picker actually came into view
  const pickerRef = useRef<HTMLDivElement>(null);
  const hasDays = !!slots?.length && !!tz;
  useEffect(() => {
    if (preview || !hasDays || picked || !pickerRef.current) return;
    const io = new IntersectionObserver(([e]) => e.isIntersecting && trackOnce("see_calendar", "see_calendar"), { threshold: 0.4 });
    io.observe(pickerRef.current);
    return () => io.disconnect();
  }, [preview, hasDays, picked]);
  const t = (name: Parameters<typeof track>[0], meta?: Parameters<typeof track>[1]) => {
    if (!preview) track(name, meta);
  };

  // Every day with times, open and taken together in order; openTimes are the bookable ones
  const days = useMemo(() => {
    if (!slots || !tz) return [];
    const open = new Set(slots);
    const map = new Map<string, string[]>();
    for (const iso of [...slots, ...taken]) {
      const key = dayKey(iso, tz);
      map.set(key, [...(map.get(key) ?? []), iso]);
    }
    return [...map.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, times]) => {
        const sorted = [...new Set(times)].sort();
        return { key, times: sorted, openTimes: sorted.filter((t) => open.has(t)) };
      });
  }, [slots, taken, tz]);
  const isOpen = (iso: string) => !!slots?.includes(iso);

  const firstOpenDay = days.find((d) => d.openTimes.length);
  const activeDay = days.find((d) => d.key === (day ?? firstOpenDay?.key ?? days[0]?.key));

  const fmtTime = (iso: string) =>
    new Date(iso).toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit",
      timeZone: tz,
    });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!picked) return;
    setError(null);

    if (page > 0) {
      const missing = missingRequired(pageQuestions, requiredSteps, values);
      if (missing) return setError(`Please answer "${missing.label}" to book.`);
    }
    if (!isLastPage) {
      t("form_continue", { page: page + 1 });
      setPage(page + 1);
      return;
    }

    setSubmitting(true);
    t("submit");

    try {
      const res = await fetch("/api/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug,
          startsAt: picked,
          ...form,
          // Only answers to questions that are showing, given the other answers
          answers: Object.fromEntries(
            questions.filter((q) => !isHidden(q, values)).map((q) => [q.key, values[q.key] ?? ""]),
          ),
          attribution: collectAttribution(),
        }),
      });
      const data = await res.json();

      if (res.ok && data.token) {
        t("booked");
        router.push(`/${slug}/prepare?b=${data.token}&new=1`);
        return;
      }

      setError(data.error ?? "Something went wrong. Please try again.");
      t("booking_error", { status: res.status });
      if (res.status === 409) {
        setPicked(null);
        setPage(0);
        await loadSlots();
      }
    } catch {
      setError("Something went wrong. Please try again.");
    }
    setSubmitting(false);
  }

  if (slots === null || !tz) {
    return (
      <div className="flex h-64 items-center justify-center text-slate-400">
        <Loader2 className="size-6 animate-spin" />
      </div>
    );
  }

  if (picked) {
    const when = new Date(picked).toLocaleDateString([], {
      weekday: "long",
      month: "long",
      day: "numeric",
      timeZone: tz,
    });

    return (
      <form onSubmit={submit} className="space-y-4">
        <button
          type="button"
          onClick={() => {
            setError(null);
            if (page > 0) setPage(page - 1);
            else setPicked(null);
          }}
          className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-900"
        >
          <ArrowLeft className="size-4" /> {page > 0 ? "Back" : "Change time"}
        </button>

        {page === 0 && <p className="text-sm font-semibold text-slate-900">Almost done: where should {firstName} reach you?</p>}

        <div className="rounded-lg bg-blue-50 px-4 py-3 text-sm text-blue-900">
          <div className="font-semibold">
            {when} at {fmtTime(picked)}
          </div>
          <div className="text-blue-800/80">{slotMinutes}-minute consultation with {firstName}</div>
        </div>

        {page > 0 ? (
          <div className="space-y-5">
            <div>
              <p className="text-xs font-medium text-slate-500" aria-live="polite">
                Before you book · {page} of {questionSteps.length} · {STEP_TITLES[step - 1]}
              </p>
              <p className="mt-1 text-sm text-slate-600">
                {firstName} asks these before confirming your consultation. Questions marked{" "}
                <span className="text-red-600">*</span> are required.
              </p>
            </div>
            {pageQuestions.map((q) => (
              <QuestionField
                key={q.key}
                question={q}
                required={isRequired(q, requiredSteps)}
                value={values[q.key] ?? ""}
                onChange={(v) => setValues((cur) => ({ ...cur, [q.key]: v }))}
              />
            ))}
          </div>
        ) : (
          <>
            <div>
              <label htmlFor="name" className="mb-1 block text-sm font-medium text-slate-700">
                Full name
              </label>
              <input
                id="name"
                required
                autoComplete="name"
                onFocus={() => !preview && trackOnce("form_start", "form_start")}
                className={inputClass}
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div>
              <label htmlFor="email" className="mb-1 block text-sm font-medium text-slate-700">
                Email
              </label>
              <input
                id="email"
                type="email"
                required
                autoComplete="email"
                className={inputClass}
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </div>
            <div>
              <label htmlFor="phone" className="mb-1 block text-sm font-medium text-slate-700">
                Phone number
              </label>
              <input
                id="phone"
                type="tel"
                required
                autoComplete="tel"
                className={inputClass}
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
              />
            </div>

            {/* honeypot: hidden from people, irresistible to bots */}
            <input
              type="text"
              name="company"
              tabIndex={-1}
              autoComplete="off"
              aria-hidden="true"
              className="absolute -left-[9999px] h-0 w-0 opacity-0"
              value={form.company}
              onChange={(e) => setForm({ ...form, company: e.target.value })}
            />

            <label className="flex items-start gap-2.5 text-xs leading-relaxed text-slate-500">
              <input
                type="checkbox"
                required
                className="mt-0.5 size-4 shrink-0 accent-blue-700"
                checked={form.consent}
                onChange={(e) => setForm({ ...form, consent: e.target.checked })}
              />
              <span>{CONSENT_TEXT}</span>
            </label>
          </>
        )}

        {error && <p className="text-sm text-red-600">{error}</p>}

        <Button
          type="submit"
          size="lg"
          disabled={submitting || (preview && isLastPage)}
          className="h-12 w-full bg-blue-700 text-base hover:bg-blue-800"
        >
          {submitting ? (
            <Loader2 className="size-4 animate-spin" />
          ) : !isLastPage ? (
            "Continue"
          ) : preview ? (
            "Booking is off in preview"
          ) : (
            "Confirm booking"
          )}
        </Button>
      </form>
    );
  }

  if (!days.length) {
    return (
      <div className="py-10 text-center text-slate-500">
        <p className="font-medium text-slate-700">No times available right now.</p>
        <p className="mt-1 text-sm">Please check back soon.</p>
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      </div>
    );
  }

  const soonest = firstOpenDay?.openTimes[0];
  const dayIndex = (key: string) => days.findIndex((d) => d.key === key);
  const relDay = (iso: string) => {
    const k = dayKey(iso, tz);
    const today = dayKey(new Date(nowMs).toISOString(), tz);
    const tomorrow = dayKey(new Date(nowMs + 86_400_000).toISOString(), tz);
    return k === today ? "Today" : k === tomorrow ? "Tomorrow" : new Date(iso).toLocaleDateString([], { weekday: "long", timeZone: tz });
  };

  return (
    <div ref={pickerRef} className="space-y-4">
      {soonest && (
        <button
          type="button"
          onClick={() => {
            t("pick_soonest", { day: dayIndex(firstOpenDay!.key), hour: Number(new Date(soonest).toLocaleTimeString("en-US", { hour: "numeric", hour12: false, timeZone: tz })) });
            setPicked(soonest);
          }}
          className="flex w-full items-center justify-between gap-3 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-left transition-colors hover:border-blue-400 active:bg-blue-100"
        >
          <span className="flex items-center gap-2.5">
            <Zap className="size-4 shrink-0 fill-blue-700 text-blue-700" />
            <span>
              <span className="block text-xs font-medium uppercase tracking-wide text-blue-700">Soonest available</span>
              <span className="block font-semibold text-slate-900">{relDay(soonest)}, {fmtTime(soonest)}</span>
            </span>
          </span>
          <span className="text-sm font-semibold text-blue-700">Book →</span>
        </button>
      )}

      <div>
        <div className="mb-2 text-sm font-medium text-slate-700">Or pick a day</div>
        {/* One swipeable row on phones (keeps the times on screen); a grid on larger screens */}
        <div className="-mx-4 flex snap-x gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:grid sm:grid-cols-5 sm:overflow-visible sm:px-0 [&::-webkit-scrollbar]:hidden">
          {days.slice(0, 15).map(({ key, times, openTimes }) => {
            const date = new Date(times[0]);
            const selected = key === activeDay?.key;
            const full = !openTimes.length;
            return (
              <button
                key={key}
                type="button"
                onClick={() => {
                  t("pick_day", { day: dayIndex(key) });
                  setDay(key);
                }}
                aria-label={full ? `${date.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric", timeZone: tz })}, no open times` : undefined}
                className={`w-[62px] shrink-0 snap-start rounded-lg border px-1 py-2 text-center transition-colors sm:w-auto ${
                  selected
                    ? full
                      ? "border-slate-400 bg-slate-200 text-slate-500"
                      : "border-blue-700 bg-blue-700 text-white"
                    : full
                      ? "border-slate-100 bg-slate-50 text-slate-400"
                      : "border-slate-200 bg-white text-slate-700 hover:border-blue-400"
                }`}
              >
                <div className="text-[11px] uppercase tracking-wide opacity-80">
                  {date.toLocaleDateString([], { weekday: "short", timeZone: tz })}
                </div>
                <div className="text-lg font-semibold leading-tight">
                  {date.toLocaleDateString([], { day: "numeric", timeZone: tz })}
                </div>
                <div className="text-[11px] opacity-80">
                  {date.toLocaleDateString([], { month: "short", timeZone: tz })}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {activeDay && (
        <div>
          <div className="mb-2 text-sm font-medium text-slate-700">
            Pick a time on {new Date(activeDay.times[0]).toLocaleDateString([], { weekday: "long", month: "short", day: "numeric", timeZone: tz })}
          </div>
          <div className="grid grid-cols-3 gap-2">
            {activeDay.times.map((iso) =>
              !isOpen(iso) ? (
                <button
                  key={iso}
                  type="button"
                  disabled
                  aria-label={`${fmtTime(iso)}, unavailable`}
                  className="cursor-not-allowed rounded-lg border border-slate-100 bg-slate-100 py-3 text-sm font-medium text-slate-400 line-through decoration-slate-300"
                >
                  {fmtTime(iso)}
                </button>
              ) : (
              <button
                key={iso}
                type="button"
                onClick={() => {
                  t("pick_time", { day: dayIndex(activeDay.key), hour: Number(new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", hour12: false, timeZone: tz })) });
                  setPicked(iso);
                }}
                className="rounded-lg border border-slate-200 bg-white py-3 text-sm font-medium text-slate-800 transition-colors hover:border-blue-700 hover:bg-blue-50"
              >
                {fmtTime(iso)}
              </button>
              ),
            )}
          </div>
          {!activeDay.openTimes.length && <p className="mt-2 text-sm text-slate-500">No open times this day. Pick another day above.</p>}
        </div>
      )}

      <p className="flex items-center gap-1.5 text-xs text-slate-400">
        <Globe className="size-3.5" /> Times shown in {tz.replace(/_/g, " ")}
      </p>
    </div>
  );
}

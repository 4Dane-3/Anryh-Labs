import { pageAnalytics, type EventRow } from "@/lib/admin/page-analytics";

// Where the people who tapped an ad stop on the booking page, and whether the fix is the ads or the
// page. Pure: the review snapshot and the batch planner load the page_events and both use this one
// verdict, so a batch with no bookings is diagnosed the same way everywhere.

export type BookingFunnel = {
  visits: number; // visits that came from a Meta ad
  sawTimes: number;
  pickedTime: number;
  startedForm: number;
  pressedConfirm: number;
  booked: number;
  tappedCall: number; // tapped "Call now" instead (a call isn't a booking, so it never shows as one)
  errors: number;
};

export type FunnelVerdict = {
  stage: "too_few_visits" | "clicks_not_arriving" | "leave_before_times" | "no_time_picked" | "form_not_started" | "form_not_finished" | "booking_errors" | "no_clear_drop" | "booking";
  /** Where the fix is: the ads (bring more of the right people), the page, both, or nothing stands out. */
  fix: "ads" | "page" | "both" | "none";
  text: string;
};

export const MIN_FUNNEL_VISITS = 20; // below this, percentages are noise

const AD_SOURCES = new Set(["meta", "facebook", "fb", "ig", "instagram"]);
const pct = (n: number, of: number) => `${Math.round((n / of) * 100)}%`;

/** The booking-page funnel for visits that came from Meta ads (the agent's other links are left out). */
export function adFunnel(rows: EventRow[], days: number, timezone: string, now = new Date()): BookingFunnel {
  const fromAds = new Set(
    rows
      .filter((r) => r.name === "view" && AD_SOURCES.has(String((r.meta as { source?: string } | null)?.source ?? "").toLowerCase()))
      .map((r) => r.session_id),
  );
  const a = pageAnalytics(
    rows.filter((r) => fromAds.has(r.session_id)),
    days,
    timezone,
    now,
  );
  const step = (key: string) => a.funnel.find((f) => f.key === key)?.sessions ?? 0;
  return {
    visits: a.sessions,
    sawTimes: step("see_calendar"),
    pickedTime: step("picked"),
    startedForm: step("form_start"),
    pressedConfirm: step("submit"),
    booked: a.booked,
    tappedCall: a.extras.callVisits,
    errors: a.extras.errors,
  };
}

/**
 * Why the ads aren't booking, from where their visitors stop. `linkClicks` is Meta's count for the same
 * days (null when unknown): far more clicks than visits means people aren't reaching the page at all.
 */
export function funnelVerdict(f: BookingFunnel, linkClicks: number | null = null): FunnelVerdict {
  const calls = f.tappedCall ? ` ${f.tappedCall} tapped Call instead, and calls don't show up as bookings.` : "";
  const v = (stage: FunnelVerdict["stage"], fix: FunnelVerdict["fix"], text: string): FunnelVerdict => ({ stage, fix, text: text + calls });

  if (f.errors >= 2) return v("booking_errors", "page", `${f.errors} people hit an error while booking. Fix that before anything else; no ad can book through a broken form.`);
  if (linkClicks !== null && linkClicks >= MIN_FUNNEL_VISITS && f.visits < linkClicks * 0.4)
    return v("clicks_not_arriving", "page", `Meta counted ${linkClicks} clicks but only ${f.visits} visits reached the booking page. The page may be slow to open, or the clicks were accidental; check the page loads quickly on a phone.`);
  if (f.visits < MIN_FUNNEL_VISITS)
    return v("too_few_visits", "ads", `Only ${f.visits} visit${f.visits === 1 ? "" : "s"} from ads so far, too few to judge the page. Getting more of the right people to tap (hooks, copy, formats) comes first.`);
  if (f.booked > 0) return v("booking", "none", `${f.booked} of ${f.visits} ad visitors booked (${pct(f.booked, f.visits)}).`);
  if (f.sawTimes / f.visits < 0.5)
    return v("leave_before_times", "both", `Only ${pct(f.sawTimes, f.visits)} of ${f.visits} ad visitors stayed long enough to see the times. Usually the ad promised something the top of the page doesn't show (it should be a free call with the agent), or the clicks were curious rather than interested. Make the ads' offer match the page before making more creative.`);
  if (f.pickedTime / f.sawTimes < 0.3)
    return v("no_time_picked", "page", `${f.sawTimes} of ${f.visits} ad visitors saw the times but only ${f.pickedTime} picked one (${pct(f.pickedTime, f.sawTimes)}). The ads are bringing people; the calendar is where they stop: too few or inconvenient times, or picking a time isn't obvious on a phone. Fix the page before changing the ads.`);
  if (f.pickedTime >= 5 && f.startedForm / f.pickedTime < 0.6)
    return v("form_not_started", "page", `${f.pickedTime} ad visitors picked a time but only ${f.startedForm} started their details. The step after picking a time loses them: fewer required questions usually helps.`);
  if (f.startedForm >= 5 && f.pressedConfirm / f.startedForm < 0.6)
    return v("form_not_finished", "page", `${f.startedForm} ad visitors started their details but only ${f.pressedConfirm} pressed Confirm. The form is too long or asks too much: require only what the agent needs.`);
  return v("no_clear_drop", "none", `${f.visits} ad visitors and no bookings yet, with no single step on the page standing out.`);
}

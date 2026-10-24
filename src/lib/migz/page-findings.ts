// What Migz checks on an agent's booking page, and what it recommends, as pure functions: the nightly
// summary gathers the facts (see nightly.ts) and this turns them into specific, numbered advice.

export type PageFacts = {
  /** Did the live page load when Migz fetched it? null = couldn't check (no public URL, network). */
  load: { ok: boolean; status: number | null } | null;
  hasPhoto: boolean;
  bioChars: number;
  headlineChars: number;
  testimonials: number;
  requiredSteps: number; // steps of questions that must be answered before booking
  openSlots7d: number; // bookable times in the next 7 days
  evenings: boolean; // any hours that run past 6pm
  weekends: boolean; // any Saturday or Sunday hours
  hasHours: boolean;
  // The last 7 days of visits (page_events); null when nobody visited
  week: {
    visits: number;
    sawTimes: number;
    pickedTime: number;
    startedForm: number;
    booked: number;
    errors: number;
    mobileShare: number | null;
    medianSeconds: number | null;
  } | null;
};

export type PageFinding = { key: string; level: "fix" | "idea"; text: string };

const MIN_VISITS = 20; // below this, percentages are noise
const pct = (n: number, of: number) => Math.round((n / of) * 100);

/** The most useful things to change on the page, "fix" before "idea", at most `max`. */
export function pageFindings(f: PageFacts, max = 4): PageFinding[] {
  const out: PageFinding[] = [];
  const add = (key: string, level: PageFinding["level"], text: string) => out.push({ key, level, text });

  if (f.load && !f.load.ok)
    add("page_down", "fix", `Your booking page didn't load when Migz checked it tonight${f.load.status ? ` (error ${f.load.status})` : ""}. People tapping your ads would see an error, so Anryh Labs has been told.`);
  if (f.hasHours && f.openSlots7d === 0) add("no_times", "fix", "There are no open times in the next 7 days, so nobody can book. Open more hours under Calendar → Working hours.");
  if (!f.hasHours) add("no_hours", "fix", "You haven't set any working hours, so nobody can book a call. Add them under Calendar → Working hours.");
  if (!f.hasPhoto) add("no_photo", "fix", "Add a photo of yourself (My page → Profile). People book calls with people they can see.");
  if (!f.headlineChars) add("no_headline", "fix", "Add a headline (My page → Profile). It's the first thing people read after your name.");
  if (f.week && f.week.errors >= 2) add("errors", "fix", `${f.week.errors} people hit an error while booking this week. Tell Anryh Labs so it can be fixed.`);

  if (f.week && f.week.visits >= MIN_VISITS) {
    const w = f.week;
    if (w.sawTimes / w.visits < 0.5)
      add("few_see_times", "idea", `Only ${pct(w.sawTimes, w.visits)}% of this week's ${w.visits} visitors got as far as seeing your times. The calendar is now right under your name, so a low number usually means a slow page or people leaving at once.`);
    else if (w.sawTimes >= MIN_VISITS / 2 && w.pickedTime / w.sawTimes < 0.3)
      add("few_pick", "idea", `${pct(w.pickedTime, w.sawTimes)}% of the people who saw your times picked one (${w.pickedTime} of ${w.sawTimes}). More open times, or times earlier in the day, tend to help.`);
    else if (w.pickedTime >= MIN_VISITS / 2 && w.startedForm / w.pickedTime < 0.6)
      add("few_start", "idea", `${pct(w.startedForm, w.pickedTime)}% of the people who picked a time started the details form. Fewer required questions (Questions page) makes it easier to finish.`);
    if (w.booked === 0 && w.visits >= 30) add("no_bookings", "idea", `${w.visits} visits this week and no bookings yet. Migz is watching where they drop off (it's in your numbers below).`);
  }

  if (f.requiredSteps >= 3) add("many_required", "idea", `${f.requiredSteps} steps of questions must be answered before someone can book. Each extra required step loses some people: require only what you need (Questions page).`);
  if (f.hasHours && f.openSlots7d > 0 && f.openSlots7d < 8) add("few_times", "idea", `Only ${f.openSlots7d} open times in the next 7 days. More choices usually means more bookings: add hours under Calendar → Working hours.`);
  if (f.hasHours && !f.evenings) add("no_evenings", "idea", "Nothing is open after 6pm. Many people look at ads after work, so an evening window can add bookings.");
  if (f.hasHours && !f.weekends) add("no_weekends", "idea", "You're closed on weekends. If you can take even a few weekend calls, they tend to fill first.");
  if (!f.testimonials) add("no_reviews", "idea", "Add 2–3 client reviews (My page → Testimonials). Once you have some, a star rating shows under your name.");
  if (f.headlineChars > 80) add("long_headline", "idea", `Your headline is ${f.headlineChars} characters. Shorter reads faster on a phone: aim for under 70.`);
  if (f.bioChars > 700) add("long_bio", "idea", `Your About text is ${f.bioChars} characters. Phones fold it after four lines, so put your most important sentence first and trim the rest.`);

  const fixes = out.filter((x) => x.level === "fix");
  const ideas = out.filter((x) => x.level === "idea");
  return [...fixes, ...ideas].slice(0, Math.max(max, fixes.length));
}

/** "Last 7 days: 42 visits · 61% saw the times · 3 booked", or null when there were no visits. */
export function pageWeekLine(f: PageFacts): string | null {
  const w = f.week;
  if (!w || !w.visits) return null;
  const bits = [`${w.visits} visit${w.visits === 1 ? "" : "s"}`, `${pct(w.sawTimes, w.visits)}% saw the times`, `${w.booked} booked`];
  if (w.mobileShare !== null) bits.push(`${Math.round(w.mobileShare * 100)}% on a phone`);
  return `Last 7 days: ${bits.join(" · ")}`;
}

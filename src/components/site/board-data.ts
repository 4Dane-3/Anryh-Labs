// Sample activity for the switchboard demo. Everything here is illustrative: the changes mirror what Migz
// writes in an agent's dashboard, and the board is labelled as sample activity wherever it appears.

export type Kind = "video" | "image";

export type Ad = {
  id: string;
  name: string;
  kind: Kind;
  spend: number; // dollars per day (share of the daily budget)
  live: boolean;
  fresh?: boolean; // launched this loop: the label rolls in
};

export type SlipState = "applied" | "proposed" | "declined";

export type Slip = {
  id: number;
  title: string;
  reason: string;
  tag: string;
  state: SlipState;
};

export type DecisionId = "pause" | "move" | "hooks" | "hold";

export const DAILY_BUDGET = 20;
export const LAMPS = 10;

export const INITIAL_ADS: Ad[] = [
  { id: "a", name: "mortgage protection", kind: "video", spend: 5, live: true },
  { id: "c", name: "protect their peace", kind: "image", spend: 6, live: true },
  { id: "x", name: "final expenses", kind: "video", spend: 5, live: true },
  { id: "y", name: "stay-at-home parents", kind: "image", spend: 4, live: true },
  { id: "e", name: "open slot", kind: "video", spend: 0, live: false },
];

export const SETUP_SLIP: Omit<Slip, "id"> = {
  title: "Set up your booked-calls campaign",
  reason: "Targets adults in your licensed states at $20/day, optimized for booked calls.",
  tag: "launch",
  state: "applied",
};

type Decision = {
  tag: string;
  title: string;
  reason: string;
  /** Returns the ads after this decision is applied. */
  apply: (ads: Ad[]) => Ad[];
};

const set = (ads: Ad[], id: string, patch: Partial<Ad>) => ads.map((a) => (a.id === id ? { ...a, ...patch } : a));

export const DECISIONS: Record<DecisionId, Decision> = {
  pause: {
    tag: "creative",
    title: "Paused the “protect their peace” image ad",
    reason: "Click-through rate was 0.41% after 2,100 impressions, a third of the other ads.",
    apply: (ads) => set(ads, "c", { live: false, spend: 0 }),
  },
  move: {
    tag: "budget",
    title: "Moved $6/day to the mortgage-protection video",
    reason: "It books calls at $21 each versus $38 for the rest of the campaign.",
    apply: (ads) => set(ads, "a", { spend: 11 }),
  },
  hooks: {
    tag: "creative",
    title: "Launched two new hooks on the winning video",
    reason: "Same body, new first three seconds: “Is your family covered if…” and “Your work policy ends when…”.",
    apply: (ads) => {
      let next = set(ads, "a", { spend: 7 });
      next = set(next, "c", { name: "is your family covered if…", kind: "video", live: true, spend: 2, fresh: true });
      next = set(next, "e", { name: "your work policy ends when…", kind: "video", live: true, spend: 2, fresh: true });
      return next;
    },
  },
  hold: {
    tag: "budget",
    title: "Held budget steady",
    reason: "The new hooks are still in Meta’s learning phase, so no changes until they have more data.",
    apply: (ads) => ads,
  },
};

export type Beat =
  | { wait: number; kind: "call" }
  | { wait: number; kind: "decide"; id: DecisionId }
  | { wait: number; kind: "reset" };

export const BEATS: Beat[] = [
  { wait: 1500, kind: "call" },
  { wait: 2100, kind: "decide", id: "pause" },
  { wait: 2300, kind: "call" },
  { wait: 1700, kind: "decide", id: "move" },
  { wait: 2500, kind: "call" },
  { wait: 1900, kind: "decide", id: "hooks" },
  { wait: 2300, kind: "call" },
  { wait: 800, kind: "call" },
  { wait: 1700, kind: "decide", id: "hold" },
  { wait: 2700, kind: "call" },
  { wait: 4400, kind: "reset" },
];

/** What the board looks like with every beat applied: the resting picture for reduced motion. */
export function finishedState() {
  let ads = INITIAL_ADS;
  let calls = 2;
  const slips: Omit<Slip, "id">[] = [SETUP_SLIP];
  for (const beat of BEATS) {
    if (beat.kind === "call") calls += 1;
    if (beat.kind === "decide") {
      const d = DECISIONS[beat.id];
      ads = d.apply(ads);
      slips.push({ title: d.title, reason: d.reason, tag: d.tag, state: "applied" });
    }
  }
  return { ads, calls: Math.min(calls, LAMPS), slips: slips.map((s, i) => ({ ...s, id: i })) };
}

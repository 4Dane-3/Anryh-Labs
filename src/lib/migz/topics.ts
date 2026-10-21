// What a life insurance agent can ask Migz to advertise. The agent picks up to three in order (the
// first is their main focus); Migz aims new creatives at them. Client-safe: the dashboard renders the
// labels, and the review prompt gets the angle notes.

export const TOPICS = {
  mortgage_protection: {
    label: "Mortgage protection",
    pitch: "Keep the family in the home if the paycheck stops.",
    angle: "New and existing homeowners. Scenes at home: the front door, the kitchen, kids' rooms. Hook on who pays the mortgage if something happens.",
  },
  final_expense: {
    label: "Final expense",
    pitch: "Cover funeral costs so the family isn't left with the bill.",
    angle: "Peace of mind and not burdening the kids. Warm, dignified family moments across generations. Never call out age or health; speak to the situation (\"so your family isn't left with the bill\").",
  },
  income_protection: {
    label: "Income protection",
    pitch: "Replace the paycheck the family relies on.",
    angle: "Working parents and breadwinners. Hook on how long the family could keep up with bills if the income stopped tomorrow.",
  },
  term_life: {
    label: "Term life for young families",
    pitch: "Affordable coverage while the kids are growing up.",
    angle: "New parents and growing families. Everyday family scenes; hook on the moment you realize someone depends on you.",
  },
  policy_review: {
    label: "Policy review",
    pitch: "Check an existing policy and stop overpaying.",
    angle: "People who bought coverage years ago and never looked again. Hook on a second look; never promise savings or lower rates.",
  },
  work_coverage_gap: {
    label: "Coverage beyond work",
    pitch: "Work life insurance ends when the job does.",
    angle: "Employees relying on a group policy. Hook: \"Your work policy ends when your job does.\" Office, commute and job-change moments.",
  },
  whole_life: {
    label: "Whole life & cash value",
    pitch: "Lifelong coverage that builds value.",
    angle: "Planners who want permanent coverage. Calm, long-term imagery. No returns, growth figures or guarantees in copy.",
  },
  retirement_iul: {
    label: "IUL & retirement planning",
    pitch: "Protection plus a way to plan for retirement.",
    angle: "Mid-career earners thinking about the future. Focus on planning conversations; never promise returns, tax outcomes or guarantees.",
  },
} as const;

export type TopicKey = keyof typeof TOPICS;
export const TOPIC_KEYS = Object.keys(TOPICS) as TopicKey[];
export const MAX_FOCUS = 3;

export const isTopic = (v: unknown): v is TopicKey => typeof v === "string" && v in TOPICS;

/** The agent's focus, cleaned: known topics only, no repeats, at most MAX_FOCUS, in their order. */
export function cleanFocus(raw: unknown): TopicKey[] {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.filter(isTopic))].slice(0, MAX_FOCUS);
}

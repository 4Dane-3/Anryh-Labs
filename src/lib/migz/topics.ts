import type { Vertical } from "@/lib/verticals";

// What an agent (or a roofer) can ask Migz to advertise. They pick up to three in order (the first is their
// main focus); Migz aims new creatives at them. Client-safe: the dashboard renders the labels, and the review
// prompt gets the angle notes.

const INSURANCE_TOPICS = {
  mortgage_protection: {
    label: "Mortgage protection",
    pitch: "Keep the family in the home if the paycheck stops.",
    angle: "New and existing homeowners. Scenes at home: the front door, the kitchen, kids' rooms. Hook on who pays the mortgage if something happens.",
  },
  final_expense: {
    label: "Final expense",
    pitch: "Cover funeral costs so the family isn't left with the bill.",
    angle: "Peace of mind and not burdening the kids. Warm, dignified family moments across generations. Say who it's for as a range (\"for people 50–85\") or a condition (\"if you're between 50 and 85\"), never tell the viewer their age or health; speak to the situation (\"so your family isn't left with the bill\").",
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

/** Roofing: every ad offers a free inspection; the topic is what brings the homeowner to want one. */
const ROOFING_TOPICS = {
  roof_replacement: {
    label: "Roof replacement",
    pitch: "An older roof checked before it becomes a problem.",
    angle: "Homeowners with roofs 15+ years old. Real homes, crews at work, before/after of finished roofs (the company's own). Hook on knowing what shape the roof is in; never say the viewer's roof is failing.",
  },
  storm_damage: {
    label: "Storm & hail check",
    pitch: "A free look after a storm, before small damage turns into leaks.",
    angle: "After hail or wind in the area. Hook on checking after the storm (\"Had the hail last week? Get it checked\"); never claim their roof is damaged, never mention deductibles or that insurance pays.",
  },
  roof_repair: {
    label: "Leaks & repairs",
    pitch: "Find the leak and fix it before it spreads.",
    angle: "Homeowners with a leak, missing shingles or a stain on the ceiling. Hook on catching it early; show a real repair.",
  },
  gutters: {
    label: "Gutters",
    pitch: "Gutters and roof edges checked with the inspection.",
    angle: "Seasonal (fall leaves, spring rain). Hook on overflowing gutters and water by the foundation; offer the free inspection.",
  },
  local_trust: {
    label: "Local & trusted",
    pitch: "A local, licensed crew the neighbors already use.",
    angle: "The owner or crew on camera, trucks and yard signs in local neighborhoods, years in town, warranty. Hook on a local name (no fake reviews or made-up numbers).",
  },
} as const;

export const TOPICS = { ...INSURANCE_TOPICS, ...ROOFING_TOPICS };

export type TopicKey = keyof typeof TOPICS;
/** Every topic (the tools' enums); use topicKeysFor for what an account can pick. */
export const TOPIC_KEYS = Object.keys(TOPICS) as TopicKey[];
export const INSURANCE_TOPIC_KEYS = Object.keys(INSURANCE_TOPICS) as TopicKey[];
export const ROOFING_TOPIC_KEYS = Object.keys(ROOFING_TOPICS) as TopicKey[];
export const topicKeysFor = (v: Vertical) => (v === "roofing" ? ROOFING_TOPIC_KEYS : INSURANCE_TOPIC_KEYS);
export const MAX_FOCUS = 3;

export const isTopic = (v: unknown): v is TopicKey => typeof v === "string" && v in TOPICS;

/** The agent's focus, cleaned: known topics only, no repeats, at most MAX_FOCUS, in their order. */
export function cleanFocus(raw: unknown): TopicKey[] {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.filter(isTopic))].slice(0, MAX_FOCUS);
}

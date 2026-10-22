// Shared by the prospect's intake form, the API, Slack formatting and the agent's question editor.

export type QuestionKind = "short_text" | "long_text" | "choice" | "date";

export type IntakeQuestion = {
  key: string;
  step: number; // 1-4, see STEP_TITLES
  sort: number;
  label: string;
  kind: QuestionKind;
  options: string[];
  allow_other: boolean;
  placeholder: string | null;
  hidden_when_key: string | null;
  hidden_when_value: string | null;
  enabled: boolean;
  required: boolean; // asked before the booking is confirmed
};

/** Stored answers: a label snapshot travels with each value so old answers survive question edits. */
export type IntakeAnswers = Record<string, { label: string; value: string }>;

export const STEP_TITLES = ["About you", "Your goals", "Your coverage", "Anything else?"];

export const KIND_LABELS: Record<QuestionKind, string> = {
  short_text: "Short answer",
  long_text: "Paragraph",
  choice: "Multiple choice",
  date: "Date",
};

export const MAX_LENGTH: Record<QuestionKind, number> = {
  short_text: 300,
  long_text: 1500,
  choice: 120,
  date: 10,
};

const q = (
  key: string,
  step: number,
  sort: number,
  label: string,
  kind: QuestionKind,
  extra: Partial<IntakeQuestion> = {},
): IntakeQuestion => ({
  key,
  step,
  sort,
  label,
  kind,
  options: [],
  allow_other: false,
  placeholder: null,
  hidden_when_key: null,
  hidden_when_value: null,
  enabled: true,
  required: false,
  ...extra,
});

const ifHasPolicy = { hidden_when_key: "existing_coverage", hidden_when_value: "No" };

export const DEFAULT_QUESTIONS: IntakeQuestion[] = [
  q("date_of_birth", 1, 0, "Date of birth", "date"),
  q("gender", 1, 1, "Gender", "choice", { options: ["Male", "Female"], allow_other: true }),
  q("marital_status", 1, 2, "Marital status", "choice", {
    options: ["Married", "Single", "Divorced", "Widowed"],
  }),
  q("nicotine", 1, 3, "Nicotine use", "choice", { options: ["Yes", "No"] }),

  q("goal", 2, 0, "What is your goal with life insurance?", "long_text", {
    placeholder: "e.g. make sure my kids are taken care of",
  }),
  q("reason", 2, 1, "What is the reason you inquired?", "long_text", {
    placeholder: "e.g. we just bought a house",
  }),

  q("existing_coverage", 3, 0, "Do you have existing coverage or a policy?", "choice", {
    options: ["Yes", "No"],
    allow_other: true,
  }),
  q("policy_description", 3, 1, "Description of policy (Term, Whole Life, IUL, Final Expense)", "short_text", {
    placeholder: "e.g. 20-year term through work",
    ...ifHasPolicy,
  }),
  q("current_premium", 3, 2, "How much do you pay for your current policy?", "short_text", {
    placeholder: "e.g. $80/month",
    ...ifHasPolicy,
  }),
  q("current_coverage", 3, 3, "How much coverage do you currently have?", "short_text", {
    placeholder: "e.g. $250,000",
    ...ifHasPolicy,
  }),
  q("affordable_budget", 3, 4, "How much can you afford?", "short_text", {
    placeholder: "e.g. $50/month",
  }),
  q("coverage_needed", 3, 5, "How much coverage do you need?", "short_text", {
    placeholder: "e.g. $500,000",
  }),

  q("notes", 4, 0, "Extra notes for your agent to know before the appointment", "long_text", {
    placeholder: "Health changes, family situation, questions you have, anything that helps.",
  }),
];

export function isHidden(question: IntakeQuestion, values: Record<string, string>) {
  return (
    !!question.hidden_when_key &&
    values[question.hidden_when_key] === question.hidden_when_value
  );
}

/** Required on its own, or because the agent made its whole step required. */
export function isRequired(question: IntakeQuestion, requiredSteps: readonly number[]) {
  return question.enabled && (question.required || requiredSteps.includes(question.step));
}

/**
 * What the booking widget asks before "Confirm booking": the required questions, plus any question
 * one of them depends on (its show/hide condition needs that answer). In step and sort order.
 */
export function preBookingQuestions(questions: IntakeQuestion[], requiredSteps: readonly number[]) {
  const keys = new Set(questions.filter((q) => isRequired(q, requiredSteps)).map((q) => q.key));
  for (const q of questions) {
    if (keys.has(q.key) && q.hidden_when_key) keys.add(q.hidden_when_key);
  }
  return questions
    .filter((q) => q.enabled && keys.has(q.key))
    .sort((a, b) => a.step - b.step || a.sort - b.sort);
}

/** The first required, visible question left blank, or null when everything required is answered. */
export function missingRequired(
  questions: IntakeQuestion[],
  requiredSteps: readonly number[],
  values: Record<string, string>,
) {
  return (
    questions.find(
      (q) => isRequired(q, requiredSteps) && !isHidden(q, values) && !(values[q.key] ?? "").trim(),
    ) ?? null
  );
}

/** Steps (1-based) that have at least one enabled question, in order. */
export function activeSteps(questions: IntakeQuestion[]) {
  return [1, 2, 3, 4].filter((s) => questions.some((qq) => qq.enabled && qq.step === s));
}

/**
 * Answers in question order. Stored answers are jsonb, and Postgres re-sorts object keys,
 * so display code must re-apply the order. Keys for deleted questions go last.
 */
export function orderedAnswers(answers: IntakeAnswers, order: string[]) {
  const rank = (key: string) => {
    const i = order.indexOf(key);
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
  };
  return Object.entries(answers).sort(([a], [b]) => rank(a) - rank(b));
}

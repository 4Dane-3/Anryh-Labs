import { isHidden, MAX_LENGTH, type IntakeAnswers, type IntakeQuestion } from "@/lib/booking/questions";
import { QUOTE_BEST_TIME, QUOTE_COVERAGE } from "@/lib/booking/constants";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function str(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export type BookingInput = {
  slug: string;
  startsAt: string;
  name: string;
  email: string;
  phone: string;
  attribution: Record<string, string>;
};

/** Returns the cleaned input, "bot" if the honeypot was filled, or a user-facing error message. */
export function parseBooking(
  body: unknown,
): { ok: true; data: BookingInput } | { ok: false; error: string; bot?: boolean } {
  const b = (body ?? {}) as Record<string, unknown>;

  if (str(b.company, 200)) return { ok: false, error: "rejected", bot: true };

  const name = str(b.name, 100);
  const email = str(b.email, 200).toLowerCase();
  const digits = str(b.phone, 30).replace(/\D/g, "");
  const startsAt = new Date(str(b.startsAt, 40));

  if (name.length < 2) return { ok: false, error: "Please enter your name." };
  if (!EMAIL_RE.test(email))
    return { ok: false, error: "Please enter a valid email." };
  if (digits.length < 10 || digits.length > 11 || (digits.length === 11 && digits[0] !== "1"))
    return { ok: false, error: "Please enter a valid US phone number." };
  if (b.consent !== true)
    return { ok: false, error: "Please agree to be contacted to book." };
  if (Number.isNaN(startsAt.getTime()))
    return { ok: false, error: "Please pick a time." };

  return {
    ok: true,
    data: {
      slug: str(b.slug, 80),
      startsAt: startsAt.toISOString(),
      name,
      email,
      phone: `+1${digits.slice(-10)}`,
      attribution: parseAttribution(b.attribution),
    },
  };
}

function parseAttribution(raw: unknown) {
  const attribution: Record<string, string> = {};
  if (raw && typeof raw === "object") {
    for (const [key, value] of Object.entries(raw).slice(0, 20)) {
      if (typeof value === "string" && /^[\w-]{1,40}$/.test(key)) {
        attribution[key] = value.slice(0, 300);
      }
    }
  }
  return attribution;
}

export type QuoteInput = {
  slug: string;
  name: string;
  phone: string;
  coverage: string | null;
  bestTime: string | null;
  attribution: Record<string, string>;
};

/** A "Get a free quote" request: name and phone are required, the two picks are optional and must be ours. */
export function parseQuote(
  body: unknown,
): { ok: true; data: QuoteInput } | { ok: false; error: string; bot?: boolean } {
  const b = (body ?? {}) as Record<string, unknown>;

  if (str(b.company, 200)) return { ok: false, error: "rejected", bot: true };

  const name = str(b.name, 100);
  const digits = str(b.phone, 30).replace(/\D/g, "");
  const coverage = str(b.coverage, 40);
  const bestTime = str(b.bestTime, 40);

  if (name.length < 2) return { ok: false, error: "Please enter your name." };
  if (digits.length < 10 || digits.length > 11 || (digits.length === 11 && digits[0] !== "1"))
    return { ok: false, error: "Please enter a valid US phone number." };
  if (b.consent !== true)
    return { ok: false, error: "Please agree to be contacted so we can send your quote." };

  return {
    ok: true,
    data: {
      slug: str(b.slug, 80),
      name,
      phone: `+1${digits.slice(-10)}`,
      coverage: (QUOTE_COVERAGE as readonly string[]).includes(coverage) ? coverage : null,
      bestTime: (QUOTE_BEST_TIME as readonly string[]).includes(bestTime) ? bestTime : null,
      attribution: parseAttribution(b.attribution),
    },
  };
}

/**
 * Keeps only answers to the agent's enabled, visible questions, trimmed to each kind's max length,
 * and snapshots each question's label next to its value.
 */
export function parseAnswers(
  raw: unknown,
  questions: IntakeQuestion[],
): { ok: true; data: IntakeAnswers } | { ok: false; error: string } {
  const input = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const values: Record<string, string> = {};
  for (const question of questions) {
    if (question.enabled) values[question.key] = str(input[question.key], MAX_LENGTH[question.kind]);
  }

  const answers: IntakeAnswers = {};
  for (const question of questions) {
    const value = values[question.key];
    if (!question.enabled || !value || isHidden(question, values)) continue;

    if (question.kind === "date") {
      const parsed = new Date(`${value}T00:00:00Z`);
      const valid =
        /^\d{4}-\d{2}-\d{2}$/.test(value) &&
        !Number.isNaN(parsed.getTime()) &&
        parsed.getUTCFullYear() >= 1900 &&
        (question.key !== "date_of_birth" || parsed.getTime() < Date.now());
      if (!valid) return { ok: false, error: `"${question.label}" doesn't look like a valid date.` };
    }

    answers[question.key] = { label: question.label, value };
  }

  return { ok: true, data: answers };
}

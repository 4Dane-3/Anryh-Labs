const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function str(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function orNull(value: unknown, max: number): string | null {
  return str(value, max) || null;
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

  const attribution: Record<string, string> = {};
  if (b.attribution && typeof b.attribution === "object") {
    for (const [key, value] of Object.entries(b.attribution).slice(0, 20)) {
      if (typeof value === "string" && /^[\w-]{1,40}$/.test(key)) {
        attribution[key] = value.slice(0, 300);
      }
    }
  }

  return {
    ok: true,
    data: {
      slug: str(b.slug, 80),
      startsAt: startsAt.toISOString(),
      name,
      email,
      phone: `+1${digits.slice(-10)}`,
      attribution,
    },
  };
}

export type IntakeInput = {
  date_of_birth: string | null;
  gender: string | null;
  marital_status: string | null;
  nicotine: string | null;
  existing_coverage: string | null;
  policy_description: string | null;
  goal: string | null;
  reason: string | null;
  budget: string | null;
  coverage_amount: string | null;
  best_time_to_reach: string | null;
  notes: string | null;
};

export function parseIntake(
  body: unknown,
): { ok: true; data: IntakeInput } | { ok: false; error: string } {
  const b = (body ?? {}) as Record<string, unknown>;

  let dob: string | null = null;
  const rawDob = str(b.date_of_birth, 10);
  if (rawDob) {
    const parsed = new Date(`${rawDob}T00:00:00Z`);
    const valid =
      /^\d{4}-\d{2}-\d{2}$/.test(rawDob) &&
      !Number.isNaN(parsed.getTime()) &&
      parsed.getUTCFullYear() >= 1900 &&
      parsed.getTime() < Date.now();
    if (!valid) return { ok: false, error: "That date of birth doesn't look right." };
    dob = rawDob;
  }

  return {
    ok: true,
    data: {
      date_of_birth: dob,
      gender: orNull(b.gender, 60),
      marital_status: orNull(b.marital_status, 60),
      nicotine: orNull(b.nicotine, 60),
      existing_coverage: orNull(b.existing_coverage, 120),
      policy_description: orNull(b.policy_description, 300),
      goal: orNull(b.goal, 1000),
      reason: orNull(b.reason, 1000),
      budget: orNull(b.budget, 200),
      coverage_amount: orNull(b.coverage_amount, 200),
      best_time_to_reach: orNull(b.best_time_to_reach, 200),
      notes: orNull(b.notes, 1500),
    },
  };
}

import { DateTime } from "luxon";
import type { Agent } from "@/lib/booking/data";
import { DEFAULT_QUESTIONS, orderedAnswers, type IntakeAnswers } from "@/lib/booking/questions";

// Prospect-supplied text goes into Slack, so neutralise mentions and links.
function esc(text: string) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function formatPhone(e164: string) {
  const d = e164.replace(/\D/g, "").slice(-10);
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}

function ageFrom(dob: string, zone: string) {
  return Math.floor(
    DateTime.now().setZone(zone).diff(DateTime.fromISO(dob, { zone }), "years").years,
  );
}

type Prospect = { name: string; email: string; phone: string; starts_at: string };

const DEFAULT_ORDER = DEFAULT_QUESTIONS.map((q) => q.key);

export function intakeLines(answers: IntakeAnswers, zone: string, order: string[] = DEFAULT_ORDER): string[] {
  return orderedAnswers(answers, order).map(([key, { label, value }]) => {
    const shown = key === "date_of_birth" ? `${value} (age ${ageFrom(value, zone)})` : value;
    // "Gender: Female", but questions keep their own punctuation: "What is your goal? Protect my kids"
    const prefix = /[?:]$/.test(label) ? label : `${label}:`;
    return esc(`${prefix} ${shown}`);
  });
}

export function newBookingMessage(
  agent: Agent,
  p: Prospect,
  opts: { intake?: IntakeAnswers; order?: string[]; moreToAsk?: boolean } = {},
) {
  const when = DateTime.fromISO(p.starts_at, { zone: agent.timezone }).toFormat(
    "ccc, LLL d 'at' h:mm a ZZZZ",
  );
  // Answers to the agent's required questions arrive with the booking
  const lines = opts.intake ? intakeLines(opts.intake, agent.timezone, opts.order) : [];
  return [
    `:calendar: *New call booked* — ${when}`,
    `*${esc(p.name)}* · ${formatPhone(p.phone)} · ${esc(p.email)}`,
    ...lines.map((l) => `• ${l}`),
    ...(opts.moreToAsk === false
      ? []
      : [`They'll be asked to fill in ${lines.length ? "the optional prep questions" : "prep questions"}. You'll get another message when they do.`]),
  ].join("\n");
}

export function intakeCompletedMessage(
  agent: Agent,
  p: Prospect,
  intake: IntakeAnswers,
) {
  const when = DateTime.fromISO(p.starts_at, { zone: agent.timezone }).toFormat(
    "ccc, LLL d 'at' h:mm a",
  );
  const lines = intakeLines(intake, agent.timezone);
  return [
    `:memo: *${esc(p.name)} answered the prep questions* (call on ${when})`,
    ...(lines.length ? lines.map((l) => `• ${l}`) : ["• (they left everything blank)"]),
  ].join("\n");
}

export type DigestBooking = Prospect & {
  intake: IntakeAnswers | null;
};

export function digestMessage(agent: Agent, bookings: DigestBooking[], now: DateTime, order?: string[]) {
  const first = agent.full_name.split(" ")[0];
  const header = `:sunrise: *Good morning, ${esc(first)}* — ${now.toFormat("cccc, LLL d")}`;

  if (!bookings.length) {
    return `${header}\nNo calls scheduled today.`;
  }

  const items = bookings.map((b) => {
    const time = DateTime.fromISO(b.starts_at, { zone: agent.timezone }).toFormat("h:mm a");
    const lines = b.intake ? intakeLines(b.intake, agent.timezone, order) : [];
    const detail = lines.length
      ? lines.map((l) => `      ${l}`).join("\n")
      : "      _No prep answers yet_";
    return `• *${time}* — ${esc(b.name)} · ${formatPhone(b.phone)} · ${esc(b.email)}\n${detail}`;
  });

  const count = `${bookings.length} call${bookings.length === 1 ? "" : "s"}`;
  return `${header}\nYou have ${count} today:\n\n${items.join("\n\n")}`;
}

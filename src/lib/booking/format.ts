import { DateTime } from "luxon";
import type { Agent } from "@/lib/booking/data";
import type { IntakeInput } from "@/lib/booking/validate";

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

export function intakeLines(intake: Partial<IntakeInput>, zone: string): string[] {
  const lines: string[] = [];

  const profile = [
    intake.date_of_birth ? `age ${ageFrom(intake.date_of_birth, zone)}` : null,
    intake.gender,
    intake.marital_status,
    intake.nicotine ? `nicotine: ${intake.nicotine}` : null,
  ].filter(Boolean);
  if (profile.length) lines.push(`Profile: ${profile.join(", ")}`);

  const existing = [intake.existing_coverage, intake.policy_description]
    .filter(Boolean)
    .join(" — ");
  if (existing) lines.push(`Existing coverage: ${existing}`);
  if (intake.goal) lines.push(`Goal: ${intake.goal}`);
  if (intake.reason) lines.push(`Why they inquired: ${intake.reason}`);
  if (intake.budget) lines.push(`Budget / current premium: ${intake.budget}`);
  if (intake.coverage_amount) lines.push(`Coverage amount: ${intake.coverage_amount}`);
  if (intake.best_time_to_reach) lines.push(`Best time to reach: ${intake.best_time_to_reach}`);
  if (intake.notes) lines.push(`Notes: ${intake.notes}`);

  return lines.map((l) => esc(l));
}

export function newBookingMessage(agent: Agent, p: Prospect) {
  const when = DateTime.fromISO(p.starts_at, { zone: agent.timezone }).toFormat(
    "ccc, LLL d 'at' h:mm a ZZZZ",
  );
  return [
    `:calendar: *New call booked* — ${when}`,
    `*${esc(p.name)}* · ${formatPhone(p.phone)} · ${esc(p.email)}`,
    `They'll be asked to fill in prep questions. You'll get another message when they do.`,
  ].join("\n");
}

export function intakeCompletedMessage(
  agent: Agent,
  p: Prospect,
  intake: Partial<IntakeInput>,
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
  intake: Partial<IntakeInput> | null;
};

export function digestMessage(agent: Agent, bookings: DigestBooking[], now: DateTime) {
  const first = agent.full_name.split(" ")[0];
  const header = `:sunrise: *Good morning, ${esc(first)}* — ${now.toFormat("cccc, LLL d")}`;

  if (!bookings.length) {
    return `${header}\nNo calls scheduled today.`;
  }

  const items = bookings.map((b) => {
    const time = DateTime.fromISO(b.starts_at, { zone: agent.timezone }).toFormat("h:mm a");
    const lines = b.intake ? intakeLines(b.intake, agent.timezone) : [];
    const detail = lines.length
      ? lines.map((l) => `      ${l}`).join("\n")
      : "      _No prep answers yet_";
    return `• *${time}* — ${esc(b.name)} · ${formatPhone(b.phone)} · ${esc(b.email)}\n${detail}`;
  });

  const count = `${bookings.length} call${bookings.length === 1 ? "" : "s"}`;
  return `${header}\nYou have ${count} today:\n\n${items.join("\n\n")}`;
}

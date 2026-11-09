import "server-only";
import { after } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { crewsOf, getSlotBoard, type Agent } from "@/lib/booking/data";
import type { IntakeAnswers, IntakeQuestion } from "@/lib/booking/questions";
import { ROOFING_ADDRESS_KEY } from "@/lib/booking/questions";
import { consentTextFor } from "@/lib/booking/constants";
import { newBookingMessage } from "@/lib/booking/format";
import { sendSlackMessage } from "@/lib/slack";
import { sendConversionEvents } from "@/lib/meta/capi";
import { markFormLeadBooked } from "@/lib/migz/leads";
import { partnerPageUrl } from "@/lib/booking/sites";
import { sendBookingConfirmation } from "@/lib/booking/email";
import { sendInspectionBooked, sendToCrm } from "@/lib/roofing/notify";
import { isRoofer } from "@/lib/verticals";
import { evaluateLead, factsFromAnswers, type FitResult, type JobRules } from "@/lib/roofing/job-rules";
import { rulesOf, saveBookingFit } from "@/lib/roofing/fit";

// Making a booking, shared by the booking page (api/bookings) and the voice agent's book tool, so both get the
// same checks (only genuinely open times, a free crew with its buffer) and the same follow-through: Slack, the
// confirmation email, the roofer's email and CRM webhook, Meta's Schedule + Lead, and markFormLeadBooked.

export type NewBooking = {
  startsAt: string; // UTC ISO, one of getSlotBoard's open times
  name: string;
  email: string; // "" when the voice agent couldn't get one (no confirmation email then)
  phone: string; // E.164
  attribution: Record<string, string>;
};

export type BookingContext = {
  answers?: IntakeAnswers;
  questions?: IntakeQuestion[];
  asked?: IntakeQuestion[];
  consentText?: string;
  timezone?: string; // the prospect's, for the confirmation email
  pageUrl?: string | null;
  origin: string;
  ip?: string | null;
  userAgent?: string | null;
  /** How the lead fit the roofer's "Jobs we take" rules, when the caller checked (else it's checked from the answers). */
  fit?: { result: FitResult; rules: JobRules | null };
};

const TAKEN = "That time was just taken. Please pick another.";

export async function createBooking(
  agent: Agent,
  input: NewBooking,
  ctx: BookingContext,
): Promise<{ ok: true; booking: { id: string; token: string; starts_at: string; ends_at: string } } | { ok: false; status: number; error: string }> {
  const answers = ctx.answers ?? {};
  const questions = ctx.questions ?? [];
  const asked = ctx.asked ?? [];

  // Only accept times that are genuinely open right now (never trust the client's clock or list)
  const { open, crewsFreeAt } = await getSlotBoard(agent);
  if (!open.includes(input.startsAt)) return { ok: false, status: 409, error: TAKEN };

  const startsAt = new Date(input.startsAt);
  const endsAt = new Date(startsAt.getTime() + agent.slot_minutes * 60_000);

  // One booking per crew per time, and only on a crew that's free here counting the buffer (travel time) around
  // its other inspections: a crew with a booking ending right at this time isn't one. The database refuses an
  // overlap on the same crew, so a crew taken a moment ago falls through to the next free one.
  const crews = crewsOf(agent);
  const order = crews === 1 ? [1] : crewsFreeAt(input.startsAt);
  if (!order.length) return { ok: false, status: 409, error: TAKEN };
  const insert = (crew: number) =>
    supabaseAdmin
      .from("bookings")
      .insert({
        agent_id: agent.id,
        starts_at: startsAt.toISOString(),
        ends_at: endsAt.toISOString(),
        name: input.name,
        email: input.email,
        phone: input.phone,
        consent_text: ctx.consentText ?? consentTextFor(isRoofer(agent)),
        attribution: input.attribution,
        ...(crews > 1 ? { crew } : {}), // the column is missing before the roofing migration; crew 1 is its default
      })
      .select("id, token, starts_at, ends_at")
      .single();
  let { data: booking, error } = await insert(order[0]);
  for (let i = 1; i < order.length && error?.code === "23P01"; i++) ({ data: booking, error } = await insert(order[i]));

  if (error || !booking) {
    // 23P01 = exclusion violation: someone else booked the same slot a moment ago
    if (error?.code === "23P01") return { ok: false, status: 409, error: TAKEN };
    console.error("booking insert failed", error);
    return { ok: false, status: 500, error: "Something went wrong. Please try again." };
  }

  // Save the answers with the booking. If those were the only questions, the intake is done.
  const moreToAsk = questions.some((q) => q.enabled && !asked.includes(q));
  if (Object.keys(answers).length) {
    const now = new Date().toISOString();
    const { error: intakeError } = await supabaseAdmin
      .from("intake_responses")
      .insert({ booking_id: booking.id, answers, submitted_at: now, completed_at: moreToAsk ? null : now });
    if (intakeError) console.error("required answers insert failed", intakeError);
  }

  if (agent.slack_user_id) {
    after(async () => {
      try {
        await sendSlackMessage(
          agent.slack_user_id!,
          newBookingMessage(agent, { name: input.name, email: input.email, phone: input.phone, starts_at: input.startsAt }, { intake: answers, order: questions.map((q) => q.key), moreToAsk }),
        );
      } catch (e) {
        console.error("slack notify failed", e);
      }
    });
  }

  // The prospect's confirmation, with the agent's photo and the call attached (no-op until Resend is set up)
  if (input.email) {
    after(async () => {
      try {
        await sendBookingConfirmation({
          agent,
          booking,
          prospect: { name: input.name, email: input.email, phone: input.phone },
          timezone: ctx.timezone,
          pageUrl: ctx.pageUrl ?? undefined,
          address: answers[ROOFING_ADDRESS_KEY]?.value ?? null,
        });
      } catch (e) {
        console.error("confirmation email failed", e);
      }
    });
  }

  // How they fit the roofer's rules (checked already by the voice agent; from the answers otherwise)
  const roof = isRoofer(agent);
  const rules = ctx.fit?.rules ?? rulesOf(agent);
  const fit = roof ? (ctx.fit?.result ?? evaluateLead(rules, factsFromAnswers(answers))) : null;
  if (fit && !ctx.fit) after(() => saveBookingFit(booking.id, fit));

  // A roofer hears about the inspection by email (with that street's postcard to print), and their CRM gets it
  if (isRoofer(agent)) {
    const inspection = { id: booking.id, starts_at: booking.starts_at, ends_at: booking.ends_at, name: input.name, email: input.email, phone: input.phone };
    after(async () => {
      await sendInspectionBooked(agent, inspection, answers, fit ? { fit, rules } : undefined).catch((e) => console.error("inspection email failed", e));
      await sendToCrm(agent, inspection, answers).catch((e) => console.error("crm webhook failed", e));
    });
  }

  // Tell Meta a call was booked: Schedule counts it on its own, Lead feeds ad sets optimizing for LEAD (no-op until configured)
  after(async () => {
    try {
      await sendConversionEvents({
        events: ["Schedule", "Lead"],
        eventId: booking.id,
        email: input.email || undefined,
        phone: input.phone,
        // A partner site's own page when the booking came from there
        pageUrl: partnerPageUrl(ctx.pageUrl) ?? `${ctx.origin}/${agent.slug}`,
        attribution: input.attribution,
        ip: ctx.ip ?? null,
        userAgent: ctx.userAgent ?? null,
      });
    } catch (e) {
      console.error("conversions api failed", e);
    }
    // Someone who sent an instant form and now booked: tell Meta on the lead, so form ads find more like them
    await markFormLeadBooked(agent.id, { phone: input.phone, email: input.email || null }, booking.id).catch((e) => console.error("marking the form lead booked failed", e));
  });

  return { ok: true, booking };
}

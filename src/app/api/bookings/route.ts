import { after } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { crewsOf, getAgentBySlug, getIntakeQuestions, getSlotBoard } from "@/lib/booking/data";
import { parseAnswers, parseBooking } from "@/lib/booking/validate";
import { missingRequired, preBookingQuestions, type IntakeAnswers } from "@/lib/booking/questions";
import { consentTextFor } from "@/lib/booking/constants";
import { newBookingMessage } from "@/lib/booking/format";
import { sendSlackMessage } from "@/lib/slack";
import { sendConversionEvents } from "@/lib/meta/capi";
import { markFormLeadBooked } from "@/lib/migz/leads";
import { partnerPageUrl } from "@/lib/booking/sites";
import { sendBookingConfirmation } from "@/lib/booking/email";
import { sendInspectionBooked, sendToCrm } from "@/lib/roofing/notify";
import { isRoofer } from "@/lib/verticals";
import { ROOFING_ADDRESS_KEY } from "@/lib/booking/questions";

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = parseBooking(body);

  if (!parsed.ok) {
    // Honeypot hit: pretend it worked so bots don't adapt
    if (parsed.bot) return Response.json({ ok: true });
    return Response.json({ error: parsed.error }, { status: 400 });
  }

  const input = parsed.data;
  const agent = await getAgentBySlug(input.slug);
  if (!agent) return Response.json({ error: "Agent not found." }, { status: 404 });

  // Questions the agent made required are answered before the booking exists, never after
  const questions = await getIntakeQuestions(agent.id);
  const requiredSteps = agent.required_intake_steps ?? [];
  const asked = preBookingQuestions(questions, requiredSteps);
  let answers: IntakeAnswers = {};
  if (asked.length) {
    const parsedAnswers = parseAnswers(body?.answers, asked);
    if (!parsedAnswers.ok) return Response.json({ error: parsedAnswers.error }, { status: 400 });
    answers = parsedAnswers.data;
    const values = Object.fromEntries(Object.entries(answers).map(([k, a]) => [k, a.value]));
    const missing = missingRequired(asked, requiredSteps, values);
    if (missing) return Response.json({ error: `Please answer "${missing.label}" to book.` }, { status: 400 });
  }

  // Only accept times that are genuinely open right now (never trust the client's clock or list)
  const { open, crewsFreeAt } = await getSlotBoard(agent);
  if (!open.includes(input.startsAt)) {
    return Response.json(
      { error: "That time was just taken. Please pick another." },
      { status: 409 },
    );
  }

  const startsAt = new Date(input.startsAt);
  const endsAt = new Date(startsAt.getTime() + agent.slot_minutes * 60_000);

  // One booking per crew per time, and only on a crew that's free here counting the buffer (travel time) around
  // its other inspections: a crew with a booking ending right at this time isn't one. The database refuses an
  // overlap on the same crew, so a crew taken a moment ago falls through to the next free one.
  const crews = crewsOf(agent);
  const order = crews === 1 ? [1] : crewsFreeAt(input.startsAt);
  if (!order.length) return Response.json({ error: "That time was just taken. Please pick another." }, { status: 409 });
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
        consent_text: consentTextFor(isRoofer(agent)),
        attribution: input.attribution,
        ...(crews > 1 ? { crew } : {}), // the column is missing before the roofing migration; crew 1 is its default
      })
      .select("id, token, starts_at, ends_at")
      .single();
  let { data: booking, error } = await insert(order[0]);
  for (let i = 1; i < order.length && error?.code === "23P01"; i++) ({ data: booking, error } = await insert(order[i]));

  if (error || !booking) {
    // 23P01 = exclusion violation: someone else booked the same slot a moment ago
    if (error?.code === "23P01") {
      return Response.json(
        { error: "That time was just taken. Please pick another." },
        { status: 409 },
      );
    }
    console.error("booking insert failed", error);
    return Response.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }

  // Save the required answers with the booking. If those were the only questions, the intake is done.
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
          newBookingMessage(agent, {
            name: input.name,
            email: input.email,
            phone: input.phone,
            starts_at: input.startsAt,
          }, { intake: answers, order: questions.map((q) => q.key), moreToAsk }),
        );
      } catch (e) {
        console.error("slack notify failed", e);
      }
    });
  }

  // The prospect's confirmation, with the agent's photo and the call attached (no-op until Resend is set up)
  after(async () => {
    try {
      await sendBookingConfirmation({
        agent,
        booking,
        prospect: { name: input.name, email: input.email, phone: input.phone },
        timezone: body?.timezone,
        pageUrl: body?.page_url,
        address: answers[ROOFING_ADDRESS_KEY]?.value ?? null,
      });
    } catch (e) {
      console.error("confirmation email failed", e);
    }
  });

  // A roofer hears about the inspection by email (with that street's postcard to print), and their CRM gets it
  if (isRoofer(agent)) {
    const inspection = { id: booking.id, starts_at: booking.starts_at, ends_at: booking.ends_at, name: input.name, email: input.email, phone: input.phone };
    after(async () => {
      await sendInspectionBooked(agent, inspection, answers).catch((e) => console.error("inspection email failed", e));
      await sendToCrm(agent, inspection, answers).catch((e) => console.error("crm webhook failed", e));
    });
  }

  // Tell Meta a call was booked: Schedule counts it on its own, Lead feeds ad sets optimizing for LEAD (no-op until configured)
  const origin = new URL(req.url).origin;
  after(async () => {
    try {
      await sendConversionEvents({
        events: ["Schedule", "Lead"],
        eventId: booking.id,
        email: input.email,
        phone: input.phone,
        // A partner site's own page when the booking came from there
        pageUrl: partnerPageUrl(body?.page_url) ?? `${origin}/${agent.slug}`,
        attribution: input.attribution,
        ip: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
        userAgent: req.headers.get("user-agent"),
      });
    } catch (e) {
      console.error("conversions api failed", e);
    }
    // Someone who sent an instant form and now booked: tell Meta on the lead, so form ads find more like them
    await markFormLeadBooked(agent.id, { phone: input.phone, email: input.email }, booking.id).catch((e) => console.error("marking the form lead booked failed", e));
  });

  return Response.json({ token: booking.token });
}

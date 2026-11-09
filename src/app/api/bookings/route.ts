import { getAgentBySlug, getIntakeQuestions } from "@/lib/booking/data";
import { parseAnswers, parseBooking } from "@/lib/booking/validate";
import { missingRequired, preBookingQuestions, type IntakeAnswers } from "@/lib/booking/questions";
import { createBooking } from "@/lib/booking/create";
import { isRoofer } from "@/lib/verticals";
import { evaluateLead, factsFromAnswers, notFitMessage, withRuleQuestions } from "@/lib/roofing/job-rules";
import { rulesOf } from "@/lib/roofing/fit";

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
  // A roofer's "Jobs we take" rules switch on (or add) the questions they need
  const roof = isRoofer(agent);
  const rules = roof ? rulesOf(agent) : null;
  const questions = withRuleQuestions(await getIntakeQuestions(agent.id), rules);
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

  // A clear mismatch with the rules gets a polite no and no booking; "not sure" never blocks, it's flagged to the roofer
  if (roof && rules) {
    const fit = evaluateLead(rules, factsFromAnswers(answers));
    if (fit.verdict === "not_fit") return Response.json({ error: notFitMessage(agent.full_name), notFit: true }, { status: 422 });
  }

  const result = await createBooking(
    agent,
    { startsAt: input.startsAt, name: input.name, email: input.email, phone: input.phone, attribution: input.attribution },
    {
      answers,
      questions,
      asked,
      timezone: body?.timezone,
      pageUrl: body?.page_url,
      origin: new URL(req.url).origin,
      ip: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
      userAgent: req.headers.get("user-agent"),
    },
  );
  if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
  return Response.json({ token: result.booking.token });
}

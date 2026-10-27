import { after } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getAgentBySlug } from "@/lib/booking/data";
import { parseQuote } from "@/lib/booking/validate";
import { QUOTE_CONSENT_TEXT } from "@/lib/booking/constants";
import { newQuoteMessage } from "@/lib/booking/format";
import { sendSlackMessage } from "@/lib/slack";
import { sendConversionEvents } from "@/lib/meta/capi";

// "Get a free quote" on the booking page: saves the request, pings the agent to call back, and tells Meta
// it was a Lead (the event ad sets optimize for).
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = parseQuote(body);

  if (!parsed.ok) {
    // Honeypot hit: pretend it worked so bots don't adapt
    if (parsed.bot) return Response.json({ ok: true });
    return Response.json({ error: parsed.error }, { status: 400 });
  }

  const input = parsed.data;
  const agent = await getAgentBySlug(input.slug);
  if (!agent) return Response.json({ error: "Agent not found." }, { status: 404 });

  const { data: quote, error } = await supabaseAdmin
    .from("quote_requests")
    .insert({
      agent_id: agent.id,
      name: input.name,
      phone: input.phone,
      coverage: input.coverage,
      best_time: input.bestTime,
      consent_text: QUOTE_CONSENT_TEXT,
      attribution: input.attribution,
    })
    .select("id")
    .single();

  if (error || !quote) {
    console.error("quote insert failed", error);
    return Response.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }

  if (agent.slack_user_id) {
    after(async () => {
      try {
        await sendSlackMessage(agent.slack_user_id!, newQuoteMessage(input));
      } catch (e) {
        console.error("slack notify failed", e);
      }
    });
  }

  const origin = new URL(req.url).origin;
  after(async () => {
    try {
      await sendConversionEvents({
        events: ["Lead"],
        eventId: quote.id,
        phone: input.phone,
        pageUrl: `${origin}/${agent.slug}`,
        attribution: input.attribution,
        ip: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
        userAgent: req.headers.get("user-agent"),
      });
    } catch (e) {
      console.error("conversions api failed", e);
    }
  });

  return Response.json({ ok: true });
}

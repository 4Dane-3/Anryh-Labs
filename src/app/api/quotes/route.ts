import { after } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getAgentBySlug } from "@/lib/booking/data";
import { parseQuote } from "@/lib/booking/validate";
import { quoteConsentTextFor } from "@/lib/booking/constants";
import { newQuoteMessage } from "@/lib/booking/format";
import { sendSlackMessage } from "@/lib/slack";
import { leadPingBlocks } from "@/lib/dashboard/outcomes";
import { sendConversionEvents } from "@/lib/meta/capi";
import { partnerPageUrl } from "@/lib/booking/sites";
import { isRoofer } from "@/lib/verticals";
import { voiceConfigured } from "@/lib/voice/elevenlabs";
import { dialLead, inspectionHoursBySlug, isDoNotCall, planColumns, planFirstCall, thankYouVoice, voiceOnFor } from "@/lib/voice/dial";
import { leadTimezone } from "@/lib/voice/rules";

// Speed to lead: Node (not edge, the Supabase and ElevenLabs clients are Node) in the region next to Supabase and
// ElevenLabs/Twilio (US East), so the call request leaves within a few hundred ms of the submit.
export const runtime = "nodejs";
export const preferredRegion = "iad1";
export const maxDuration = 30;

// "Get a free quote" on the booking page (insurance) or "Talk to us about a free inspection" (roofers): saves the
// request, has the voice agent call them within seconds (when on), pings the account, and tells Meta it was a
// Lead (the event ad sets optimize for).
export async function POST(req: Request) {
  const submittedAt = new Date();
  const body = await req.json().catch(() => null);
  const parsed = parseQuote(body);

  if (!parsed.ok) {
    // Honeypot hit: pretend it worked so bots don't adapt
    if (parsed.bot) return Response.json({ ok: true });
    return Response.json({ error: parsed.error }, { status: 400 });
  }

  const input = parsed.data;
  // Everything the call needs is read alongside the account, so the dial is the first thing after the insert
  const voiceEnv = voiceConfigured();
  const [agent, doNotCall, hours] = await Promise.all([
    getAgentBySlug(input.slug),
    voiceEnv ? isDoNotCall(input.phone) : Promise.resolve(false),
    voiceEnv ? inspectionHoursBySlug(input.slug) : Promise.resolve(""),
  ]);
  if (!agent) return Response.json({ error: "Agent not found." }, { status: 404 });

  const roof = isRoofer(agent);
  const tz = leadTimezone(input.timezone, agent.timezone);
  const plan = planFirstCall({ on: voiceOnFor(agent), phone: input.phone, doNotCall, tz, now: submittedAt });

  const { data: quote, error } = await supabaseAdmin
    .from("quote_requests")
    .insert({
      agent_id: agent.id,
      name: input.name,
      phone: input.phone,
      coverage: roof ? null : input.coverage,
      best_time: input.bestTime,
      consent_text: quoteConsentTextFor(roof),
      attribution: input.attribution,
      ...(roof ? { address: input.address, city: input.city, roof_issue: input.roofIssue } : {}),
      ...(plan.kind === "off" ? {} : { received_at: submittedAt.toISOString(), ...planColumns(plan, tz) }),
    })
    .select("id")
    .single();

  if (error || !quote) {
    console.error("quote insert failed", error);
    return Response.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }

  // The call request goes out now, before the response; after() only keeps the function alive until it returns
  if (plan.kind === "now") {
    console.log(`[voice] lead ${quote.id}: submit→inserted ${Date.now() - submittedAt.getTime()}ms`);
    const call = dialLead({
      account: agent,
      lead: { id: quote.id, name: input.name, phone: input.phone, city: input.city, address: input.address, roof_issue: input.roofIssue, coverage: input.coverage, source: "page" },
      attempt: 1,
      reason: "instant",
      hours,
      tz,
      submittedAt,
    }).catch((e) => console.error("[voice] dial failed", e));
    after(() => call);
  }
  const voice = await thankYouVoice(plan, tz);

  if (agent.slack_user_id) {
    after(async () => {
      try {
        const text = newQuoteMessage({
          ...input,
          voice: voice?.status === "calling" ? "The voice agent is calling them now" : voice?.status === "scheduled" ? `The voice agent calls them at ${voice.label}` : null,
        });
        await sendSlackMessage(agent.slack_user_id!, text, leadPingBlocks(text, "lead", quote.id));
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
        // A partner site's own page when the booking came from there
        pageUrl: partnerPageUrl(body?.page_url) ?? `${origin}/${agent.slug}`,
        attribution: input.attribution,
        ip: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
        userAgent: req.headers.get("user-agent"),
      });
    } catch (e) {
      console.error("conversions api failed", e);
    }
  });

  return Response.json({ ok: true, voice });
}

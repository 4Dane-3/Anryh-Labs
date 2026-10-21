import { after } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getAgentBySlug, getOpenSlots } from "@/lib/booking/data";
import { parseBooking } from "@/lib/booking/validate";
import { CONSENT_TEXT } from "@/lib/booking/constants";
import { newBookingMessage } from "@/lib/booking/format";
import { sendSlackMessage } from "@/lib/slack";

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

  // Only accept times that are genuinely open right now (never trust the client's clock or list)
  const open = await getOpenSlots(agent);
  if (!open.includes(input.startsAt)) {
    return Response.json(
      { error: "That time was just taken. Please pick another." },
      { status: 409 },
    );
  }

  const startsAt = new Date(input.startsAt);
  const endsAt = new Date(startsAt.getTime() + agent.slot_minutes * 60_000);

  const { data: booking, error } = await supabaseAdmin
    .from("bookings")
    .insert({
      agent_id: agent.id,
      starts_at: startsAt.toISOString(),
      ends_at: endsAt.toISOString(),
      name: input.name,
      email: input.email,
      phone: input.phone,
      consent_text: CONSENT_TEXT,
      attribution: input.attribution,
    })
    .select("token")
    .single();

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
          }),
        );
      } catch (e) {
        console.error("slack notify failed", e);
      }
    });
  }

  return Response.json({ token: booking.token });
}

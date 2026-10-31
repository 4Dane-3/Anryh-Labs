import { supabaseAdmin } from "@/lib/supabase-admin";
import { getAgentBySlug, getIntakeQuestions } from "@/lib/booking/data";
import { preBookingQuestions } from "@/lib/booking/questions";
import { callButtonShows, displayPhone } from "@/lib/booking/call";

// What an agent's booking page shows, for sites that host it themselves (see lib/booking/sites.ts):
// testimonials, the questions asked before booking, the quote option and the call button. Public: the
// same things the agent's page shows anyone.
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const agent = await getAgentBySlug(slug);
  if (!agent) return Response.json({ error: "Not found" }, { status: 404 });

  const [{ data: testimonials }, questions, { data: hours }] = await Promise.all([
    supabaseAdmin.from("testimonials").select("id, author_name, author_detail, quote, rating").eq("agent_id", agent.id).eq("published", true).order("sort"),
    getIntakeQuestions(agent.id),
    supabaseAdmin.from("availability_rules").select("weekday, start_time, end_time").eq("agent_id", agent.id),
  ]);
  const requiredSteps = agent.required_intake_steps ?? [];
  const call = callButtonShows(agent, hours ?? []) && agent.call_phone ? { phone: agent.call_phone, display: displayPhone(agent.call_phone) } : null;

  return Response.json(
    {
      name: agent.full_name,
      title: agent.title,
      headline: agent.headline,
      licensedStates: agent.licensed_states,
      licenseNumber: agent.license_number,
      slotMinutes: agent.slot_minutes ?? 30,
      testimonials: (testimonials ?? []).map((t) => ({ id: t.id, name: t.author_name, detail: t.author_detail, quote: t.quote, rating: t.rating === null ? null : Number(t.rating) })),
      questions: preBookingQuestions(questions, requiredSteps),
      requiredSteps,
      quoteMode: agent.quote_mode ?? "folded",
      // null until the agent sets it (the host site then shows its own list); [] when they chose to show none
      partnerCarriers: agent.partner_carriers ?? null,
      call,
    },
    // The call button follows the agent's hours, so this stays fresh
    { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" } },
  );
}

import { getAgentBySlug, getOpenSlots } from "@/lib/booking/data";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const agent = await getAgentBySlug(slug);
  if (!agent) return Response.json({ error: "Not found" }, { status: 404 });

  const slots = await getOpenSlots(agent);
  return Response.json(
    { slots, slotMinutes: agent.slot_minutes, timezone: agent.timezone },
    { headers: { "Cache-Control": "no-store" } },
  );
}

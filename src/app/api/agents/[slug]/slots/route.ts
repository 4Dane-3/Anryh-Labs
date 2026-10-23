import { getAgentBySlug, getSlotBoard } from "@/lib/booking/data";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const agent = await getAgentBySlug(slug);
  if (!agent) return Response.json({ error: "Not found" }, { status: 404 });

  // Open times can be booked; taken ones (booked, or held by ghost bookings) are shown greyed out
  const { open, taken } = await getSlotBoard(agent);
  return Response.json(
    { slots: open, taken, slotMinutes: agent.slot_minutes, timezone: agent.timezone },
    { headers: { "Cache-Control": "no-store" } },
  );
}

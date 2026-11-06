import { bookingAddress, getBookingByToken } from "@/lib/booking/data";
import { isRoofer } from "@/lib/verticals";
import { bookingIcs } from "@/lib/booking/ics";

export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get("token") ?? "";
  const booking = await getBookingByToken(token);
  if (!booking) return new Response("Not found", { status: 404 });

  const roof = isRoofer(booking.agents) ? { address: await bookingAddress(booking.id) } : null;
  const ics = bookingIcs(booking, booking.agents.full_name, roof);

  return new Response(ics, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'attachment; filename="appointment.ics"',
    },
  });
}

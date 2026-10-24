import { getBookingByToken } from "@/lib/booking/data";

const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const escapeIcs = (s: string) => s.replace(/[\\;,]/g, (c) => `\\${c}`).replace(/\n/g, "\\n");

export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get("token") ?? "";
  const booking = await getBookingByToken(token);
  if (!booking) return new Response("Not found", { status: 404 });

  const agent = booking.agents;
  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Anryh Labs//Booking//EN",
    "BEGIN:VEVENT",
    `UID:${booking.id}@anryhlabs.com`,
    `DTSTAMP:${stamp(new Date())}`,
    `DTSTART:${stamp(new Date(booking.starts_at))}`,
    `DTEND:${stamp(new Date(booking.ends_at))}`,
    `SUMMARY:${escapeIcs(`Life insurance consultation with ${agent.full_name}`)}`,
    `DESCRIPTION:${escapeIcs(`Your scheduled consultation with ${agent.full_name}.`)}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");

  return new Response(ics, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'attachment; filename="appointment.ics"',
    },
  });
}

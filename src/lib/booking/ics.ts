// The calendar file for a booked call: the "Add to my calendar" download and the confirmation email's
// attachment. Pure, so the email and the route build the same event.

const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const escapeIcs = (s: string) => s.replace(/[\\;,]/g, (c) => `\\${c}`).replace(/\n/g, "\\n");

export function bookingIcs(booking: { id: string; starts_at: string; ends_at: string }, agentName: string) {
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Anryh Labs//Booking//EN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${booking.id}@anryhlabs.com`,
    `DTSTAMP:${stamp(new Date())}`,
    `DTSTART:${stamp(new Date(booking.starts_at))}`,
    `DTEND:${stamp(new Date(booking.ends_at))}`,
    `SUMMARY:${escapeIcs(`Life insurance consultation with ${agentName}`)}`,
    `DESCRIPTION:${escapeIcs(`Your scheduled consultation with ${agentName}. ${agentName} will call you at the number you gave.`)}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
}

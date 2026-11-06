// The calendar file attached to a CRM meeting invite. The same UID with a higher SEQUENCE updates the
// event in the client's calendar when the invite is re-sent; METHOD:CANCEL removes it. Pure.

const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const escapeIcs = (s: string) => s.replace(/[\\;,]/g, (c) => `\\${c}`).replace(/\r?\n/g, "\\n");

// Lines over 75 octets are folded (RFC 5545 §3.1), or strict calendars drop the event
function fold(line: string) {
  const out: string[] = [];
  let rest = line;
  while (rest.length > 74) {
    out.push(rest.slice(0, 74));
    rest = " " + rest.slice(74);
  }
  out.push(rest);
  return out.join("\r\n");
}

export function meetingIcs(
  m: { id: string; title: string; starts_at: string; ends_at: string; meeting_url: string | null; meeting_details: string | null; description: string | null; sequence: number },
  organizer: { name: string; email: string | null },
  method: "PUBLISH" | "CANCEL" = "PUBLISH",
) {
  const description = [m.description, m.meeting_url && `Join: ${m.meeting_url}`, m.meeting_details].filter(Boolean).join("\n\n");
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Anryh Labs//CRM//EN",
    `METHOD:${method}`,
    "BEGIN:VEVENT",
    `UID:crm-${m.id}@anryhlabs.com`,
    `SEQUENCE:${m.sequence}`,
    `DTSTAMP:${stamp(new Date())}`,
    `DTSTART:${stamp(new Date(m.starts_at))}`,
    `DTEND:${stamp(new Date(m.ends_at))}`,
    `SUMMARY:${escapeIcs(m.title)}`,
    description && `DESCRIPTION:${escapeIcs(description)}`,
    m.meeting_url && `LOCATION:${escapeIcs(m.meeting_url)}`,
    m.meeting_url && `URL:${m.meeting_url}`,
    organizer.email && `ORGANIZER;CN=${escapeIcs(organizer.name)}:mailto:${organizer.email}`,
    `STATUS:${method === "CANCEL" ? "CANCELLED" : "CONFIRMED"}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].filter((l): l is string => !!l);
  return lines.map(fold).join("\r\n");
}

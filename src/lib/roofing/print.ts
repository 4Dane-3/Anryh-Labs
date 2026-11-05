// What a roofer prints for a booked inspection's street: a neighbor postcard (6.5 x 9 in, sized for USPS Every
// Door Direct Mail) and a door hanger the crew leaves on nearby doors. Both name only the street, never the
// customer, and carry a QR code to the roofer's booking page tagged with the street. Pure.

/** "1420 Oak St, Plano, TX 75023" -> "Oak St". Null when there's no street to use. */
export function streetOf(address: string | null | undefined): string | null {
  const first = (address ?? "").split(",")[0]?.trim() ?? "";
  const street = first
    .replace(/^\d+[a-z]?(-\d+)?\s+/i, "") // house number
    .replace(/\s+(apt|unit|suite|ste|#)\s*\S+$/i, "") // unit
    .replace(/\s+/g, " ")
    .trim();
  return street && /[a-z]/i.test(street) ? street : null;
}

/** The city part of an address ("Plano"), for the postcard's local line. */
export function cityOf(address: string | null | undefined): string | null {
  const parts = (address ?? "").split(",").map((p) => p.trim()).filter(Boolean);
  return parts.length >= 2 ? parts[1].replace(/\s+\d{5}(-\d{4})?$/, "") || null : null;
}

const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);

/** The booking page link on a street's postcard or door hanger, tagged so bookings from it show where they came from. */
export function printLink(pageUrl: string, kind: "postcard" | "door_hanger", street: string | null) {
  const url = new URL(pageUrl);
  url.searchParams.set("utm_source", kind);
  url.searchParams.set("utm_medium", "print");
  if (street) url.searchParams.set("utm_campaign", slugify(street));
  return url.toString();
}

/** "(555) 014-0199" from E.164. */
export function displayPhone(e164: string | null | undefined) {
  const d = (e164 ?? "").replace(/\D/g, "");
  const n = d.length === 11 && d.startsWith("1") ? d.slice(1) : d;
  return n.length === 10 ? `(${n.slice(0, 3)}) ${n.slice(3, 6)}-${n.slice(6)}` : e164 ?? "";
}

// The insurance companies an agent lists on their page ("Partnered Insurance Companies"). Free text, so an
// agent can add any company; the common ones are offered as suggestions while typing.

export const MAX_CARRIERS = 30;
export const MAX_CARRIER_LENGTH = 60;

export const CARRIER_SUGGESTIONS = [
  "Mutual of Omaha",
  "Foresters Financial",
  "Transamerica",
  "Corebridge Financial",
  "Americo",
  "Aetna",
  "SPLI Term",
  "SPLI Life",
  "Lafayette Life",
  "United Home Life",
  "Senior Life",
  "Guaranteed Trust Life",
  "Ethos Life",
  "American Income Life",
  "Fidelity Life",
];

/** Tidies a list typed by an agent: trimmed, single spaces, no repeats (ignoring case), capped. */
export function cleanCarriers(raw: unknown): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of Array.isArray(raw) ? raw : []) {
    if (typeof item !== "string") continue;
    const name = item.replace(/\s+/g, " ").trim().slice(0, MAX_CARRIER_LENGTH);
    const key = name.toLowerCase();
    if (!name || seen.has(key)) continue;
    seen.add(key);
    out.push(name);
    if (out.length >= MAX_CARRIERS) break;
  }
  return out;
}

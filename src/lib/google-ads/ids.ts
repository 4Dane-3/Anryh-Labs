// Google Ads customer IDs and resource names. Pure, so the tests cover it.

/** "123-456-7890", "1234567890" or a Google Ads link with ocid/__c=… as "1234567890"; null when it isn't one. */
export function customerIdFrom(input: string): string | null {
  const s = input.trim();
  const fromLink = s.match(/[?&](?:__c|ocid|customerId)=(\d{10})\b/);
  if (fromLink) return fromLink[1];
  const digits = s.replace(/[\s-]/g, "");
  return /^\d{10}$/.test(digits) ? digits : null;
}

/** "1234567890" as Google shows it: "123-456-7890". */
export const formatCustomerId = (id: string) => (/^\d{10}$/.test(id) ? `${id.slice(0, 3)}-${id.slice(3, 6)}-${id.slice(6)}` : id);

export const customerResource = (id: string) => `customers/${id}`;

/** The id at the end of a resource name: "customers/1/campaigns/22" → "22"; "customers/1/adGroupCriteria/5~9" → "5~9". */
export const idOf = (resourceName: string) => resourceName.split("/").pop() ?? "";

/** A service area as Google's proximity address: a ZIP, a street address, or a city (in the roofer's state). */
export function proximityAddress(serviceArea: string, state?: string | null): Record<string, string> | null {
  const where = serviceArea.trim();
  if (!where) return null;
  const zip = where.match(/\b(\d{5})(?:-\d{4})?\b/)?.[1];
  const parts = where.split(",").map((p) => p.trim()).filter(Boolean);
  const stateIn = parts.map((p) => p.match(/^([A-Z]{2})(?:\s+\d{5}(?:-\d{4})?)?$/)?.[1]).find(Boolean) ?? state ?? null;
  const out: Record<string, string> = { countryCode: "US" };
  if (stateIn) out.provinceCode = stateIn;
  if (/^\d+[a-z]?\s+\S/i.test(parts[0] ?? "") && parts.length >= 2) {
    out.streetAddress = parts[0];
    out.cityName = parts[1];
  } else if (!/^\d{5}/.test(parts[0] ?? "")) {
    out.cityName = (parts[0] ?? "").replace(/\b\d{5}(-\d{4})?\b/, "").trim();
  }
  if (zip) out.postalCode = zip;
  if (!out.cityName) delete out.cityName;
  return out.postalCode || out.cityName ? out : null;
}

/** The city in a service area ("1520 K Ave, Plano, TX" → "Plano"), for city keywords; null for a bare ZIP. */
export function cityOf(serviceArea: string | null | undefined): string | null {
  const addr = proximityAddress(serviceArea ?? "");
  const city = addr?.cityName?.trim();
  return city && /^[A-Za-z .'-]{2,40}$/.test(city) ? city : null;
}

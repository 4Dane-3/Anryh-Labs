import "server-only";
import { promises as dns } from "node:dns";
import { AD_DOMAIN_A } from "@/lib/booking/ad-domain";

/** Whether the domain's DNS points at us (a CNAME to Vercel, or its address). */
export async function dnsPointsHere(domain: string): Promise<boolean> {
  try {
    const cnames = await dns.resolveCname(domain);
    if (cnames.some((c) => /vercel-dns\.com\.?$/i.test(c))) return true;
  } catch {}
  try {
    return (await dns.resolve4(domain)).includes(AD_DOMAIN_A);
  } catch {
    return false;
  }
}

const vercelReady = () => !!(process.env.VERCEL_API_TOKEN && process.env.VERCEL_PROJECT_ID);
const q = () => (process.env.VERCEL_TEAM_ID ? `?teamId=${encodeURIComponent(process.env.VERCEL_TEAM_ID)}` : "");

/** Adds the domain to our Vercel project so it serves (and gets a certificate). False when Vercel isn't configured or refused it. */
export async function addDomainToVercel(domain: string): Promise<{ done: boolean; error?: string }> {
  if (!vercelReady()) return { done: false };
  try {
    const res = await fetch(`https://api.vercel.com/v10/projects/${process.env.VERCEL_PROJECT_ID}/domains${q()}`, {
      method: "POST",
      headers: { authorization: `Bearer ${process.env.VERCEL_API_TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({ name: domain }),
      signal: AbortSignal.timeout(15_000),
    });
    if (res.ok) return { done: true };
    const body = (await res.json().catch(() => ({}))) as { error?: { code?: string; message?: string } };
    if (body.error?.code === "domain_already_in_use" || /already/i.test(body.error?.message ?? "")) return { done: true };
    return { done: false, error: body.error?.message ?? `Vercel said ${res.status}` };
  } catch (e) {
    return { done: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Whether Vercel serves the domain with a valid setup (always true when Vercel isn't configured: DNS alone decides). */
export async function vercelServes(domain: string): Promise<boolean> {
  if (!vercelReady()) return true;
  try {
    const res = await fetch(`https://api.vercel.com/v6/domains/${encodeURIComponent(domain)}/config${q()}`, { headers: { authorization: `Bearer ${process.env.VERCEL_API_TOKEN}` }, signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return false;
    return ((await res.json()) as { misconfigured?: boolean }).misconfigured === false;
  } catch {
    return false;
  }
}

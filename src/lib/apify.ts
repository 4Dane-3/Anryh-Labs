import "server-only";

// Apify, for the scrapers Migz uses to study competitors: Google Maps, Google's Ads Transparency Center, Meta's
// Ad Library and Google reviews. Runs are started async and checked later (a run can take minutes), so nothing
// waits inside one request. Key: APIFY_API (or APIFY_TOKEN / APIFY_GOOGLE_ADS_API_KEY). Every run carries a hard spend cap.
//
// Facebook and Meta pages are never fetched from our servers: Meta ads only come through Apify.

const API = "https://api.apify.com/v2";
const token = () => process.env.APIFY_API || process.env.APIFY_TOKEN || process.env.APIFY_GOOGLE_ADS_API_KEY || "";
export const apifyReady = () => !!token();

export type RunState = "READY" | "RUNNING" | "SUCCEEDED" | "FAILED" | "ABORTED" | "TIMED-OUT" | "TIMING-OUT" | "ABORTING";
export type ApifyRun = { id: string; status: RunState; defaultDatasetId: string; usageTotalUsd?: number; startedAt?: string };

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API}${path}`, { ...init, headers: { Authorization: `Bearer ${token()}`, "Content-Type": "application/json", ...(init.headers ?? {}) } });
  const body = (await res.json().catch(() => ({}))) as { data?: T; error?: { message?: string } };
  if (!res.ok) throw new Error(`Apify ${res.status}: ${body.error?.message ?? "request failed"}`);
  return (body.data ?? body) as T;
}

/** Starts an actor run ("owner/name"). Returns at once; check it with getRun. */
export async function startRun(actor: string, input: unknown, opts: { maxUsd: number; maxItems?: number; timeoutSecs?: number }) {
  const q = new URLSearchParams({ maxTotalChargeUsd: String(opts.maxUsd), timeout: String(opts.timeoutSecs ?? 900) });
  if (opts.maxItems) q.set("maxItems", String(opts.maxItems));
  return call<ApifyRun>(`/acts/${actor.replace("/", "~")}/runs?${q}`, { method: "POST", body: JSON.stringify(input) });
}

export const getRun = (id: string) => call<ApifyRun>(`/actor-runs/${id}`);

export const finished = (s: RunState) => s === "SUCCEEDED" || s === "FAILED" || s === "ABORTED" || s === "TIMED-OUT";

/** A finished run's items (a timed-out or capped run still has what it found). */
export async function datasetItems<T = Record<string, unknown>>(datasetId: string, limit = 1000): Promise<T[]> {
  const res = await fetch(`${API}/datasets/${datasetId}/items?clean=true&format=json&limit=${limit}`, { headers: { Authorization: `Bearer ${token()}` } });
  if (!res.ok) throw new Error(`Apify dataset ${res.status}`);
  return (await res.json()) as T[];
}

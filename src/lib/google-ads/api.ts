import "server-only";

// The Google Ads API over REST, as Anryh Labs' manager account (MCC). One Google sign-in on the manager account
// (its refresh token) reaches every client account linked under it; each request names the manager account as
// login-customer-id. Env:
//   GOOGLE_ADS_DEVELOPER_TOKEN   from the manager account's API Center (test access only reaches test accounts)
//   GOOGLE_ADS_CLIENT_ID / GOOGLE_ADS_CLIENT_SECRET   an OAuth client in Google Cloud
//   GOOGLE_ADS_REFRESH_TOKEN     a refresh token for a user with access to the manager account (scope adwords)
//   GOOGLE_ADS_MANAGER_ID        the manager account's 10-digit id
//   GOOGLE_ADS_API_VERSION       optional, e.g. "v22" (Google retires each version after about a year)

const VERSION = () => process.env.GOOGLE_ADS_API_VERSION || "v22";
const BASE = () => `https://googleads.googleapis.com/${VERSION()}`;

export const managerId = () => (process.env.GOOGLE_ADS_MANAGER_ID ?? "").replace(/\D/g, "");

/** Whether everything the API needs is set. Until then, setup still records the account and Migz waits. */
export function googleAdsReady() {
  return !!(process.env.GOOGLE_ADS_DEVELOPER_TOKEN && process.env.GOOGLE_ADS_CLIENT_ID && process.env.GOOGLE_ADS_CLIENT_SECRET && process.env.GOOGLE_ADS_REFRESH_TOKEN && managerId().length === 10);
}

/** MIGZ_TEST_MODE=1 or GOOGLE_ADS_VALIDATE_ONLY=1: every change is sent with validateOnly, so Google checks it and nothing changes. */
export const validateOnly = () => process.env.GOOGLE_ADS_VALIDATE_ONLY === "1" || process.env.MIGZ_TEST_MODE === "1";

export class GoogleAdsError extends Error {
  constructor(
    message: string,
    public status: number,
    public details: unknown,
  ) {
    super(message);
  }
}

let token: { value: string; expires: number } | null = null;

async function accessToken() {
  if (token && token.expires > Date.now() + 60_000) return token.value;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: process.env.GOOGLE_ADS_CLIENT_ID ?? "",
      client_secret: process.env.GOOGLE_ADS_CLIENT_SECRET ?? "",
      refresh_token: process.env.GOOGLE_ADS_REFRESH_TOKEN ?? "",
    }),
  });
  const body = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error_description?: string };
  if (!res.ok || !body.access_token) throw new GoogleAdsError(`Google sign-in failed: ${body.error_description ?? res.status}`, res.status, body);
  token = { value: body.access_token, expires: Date.now() + (body.expires_in ?? 3600) * 1000 };
  return token.value;
}

/** The first readable error in a Google Ads failure ("…: KEYWORD_HAS_INVALID_CHARS"). */
export function errorText(body: unknown): string {
  const b = body as { error?: { message?: string; details?: { errors?: { message?: string; errorCode?: Record<string, string> }[] }[] } };
  const first = b?.error?.details?.flatMap((d) => d.errors ?? [])[0];
  if (first) return `${first.message ?? "Google Ads error"}${first.errorCode ? ` (${Object.values(first.errorCode)[0]})` : ""}`;
  return b?.error?.message ?? "Google Ads error";
}

export async function request<T>(path: string, body: unknown, opts: { loginCustomerId?: string | null } = {}): Promise<T> {
  const login = opts.loginCustomerId === undefined ? managerId() : opts.loginCustomerId;
  const res = await fetch(`${BASE()}/${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${await accessToken()}`,
      "developer-token": process.env.GOOGLE_ADS_DEVELOPER_TOKEN ?? "",
      ...(login ? { "login-customer-id": login } : {}),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as unknown;
  if (!res.ok) throw new GoogleAdsError(errorText(json), res.status, json);
  return json as T;
}

/** Runs a GAQL query in a client account and returns every row (pages through results). */
export async function search<T = Record<string, unknown>>(customerId: string, query: string): Promise<T[]> {
  const rows: T[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < 20; page++) {
    const res = await request<{ results?: T[]; nextPageToken?: string }>(`customers/${customerId}/googleAds:search`, { query: query.replace(/\s+/g, " ").trim(), ...(pageToken ? { pageToken } : {}) });
    rows.push(...(res.results ?? []));
    if (!res.nextPageToken) break;
    pageToken = res.nextPageToken;
  }
  return rows;
}

export type MutateOperation = Record<string, unknown>;
export type MutateResult = { mutateOperationResponses?: Record<string, { resourceName?: string }>[]; partialFailureError?: unknown };

/** Applies changes in one request (all or nothing unless partial), honoring validate-only mode. */
export async function mutate(customerId: string, operations: MutateOperation[], opts: { partial?: boolean } = {}): Promise<MutateResult> {
  if (!operations.length) return { mutateOperationResponses: [] };
  return request<MutateResult>(`customers/${customerId}/googleAds:mutate`, { mutateOperations: operations, partialFailure: !!opts.partial, validateOnly: validateOnly() });
}

/** The resource names a mutate created, in order (empty strings in validate-only mode). */
export const createdNames = (r: MutateResult) => (r.mutateOperationResponses ?? []).map((op) => Object.values(op)[0]?.resourceName ?? "");

// GAQL rows come back camelCased with int64s as strings
export const num = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" ? Number(v) || 0 : 0);
export const centsOf = (micros: unknown) => Math.round(num(micros) / 10_000);
export const microsOf = (cents: number) => String(Math.round(cents) * 10_000);

import "server-only";
import { createHmac } from "node:crypto";

// Minimal Graph API client for the Marketing API. Version is pinned (Meta auto-upgrades unpinned
// calls); override with META_GRAPH_VERSION when moving to a newer release.
const VERSION = process.env.META_GRAPH_VERSION || "v25.0";
const BASE = `https://graph.facebook.com/${VERSION}`;

// Throttling / transient codes worth retrying (https://developers.facebook.com/docs/graph-api/overview/rate-limiting)
const RETRYABLE_CODES = new Set([1, 2, 4, 17, 32, 341, 613, 80000, 80003, 80004, 80014]);
// Rate limits: Meta refused the call without doing it, so even a create is safe to repeat
const THROTTLE_CODES = new Set([4, 17, 32, 341, 613, 80000, 80003, 80004, 80014]);
// POSTs that make a new object: after a 5xx or "unknown error" it may exist already, so a retry could duplicate it
const CREATES = /\/(campaigns|adsets|ads|adcreatives|advideos|adimages)$/;

export class MetaApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: number,
    readonly subcode?: number,
    readonly userMessage?: string,
    readonly fbtraceId?: string,
  ) {
    super(message);
    this.name = "MetaApiError";
  }
}

function token() {
  const t = process.env.META_SYSTEM_USER_TOKEN;
  if (!t) throw new Error("META_SYSTEM_USER_TOKEN is not set");
  return t;
}

function encode(params: Record<string, unknown>) {
  const out = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    out.set(key, typeof value === "object" ? JSON.stringify(value) : String(value));
  }
  const accessToken = token();
  out.set("access_token", accessToken);
  // appsecret_proof proves calls come from our server (recommended for system user tokens)
  if (process.env.META_APP_SECRET) {
    out.set("appsecret_proof", createHmac("sha256", process.env.META_APP_SECRET).update(accessToken).digest("hex"));
  }
  return out;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function graph<T = Record<string, unknown>>(
  method: "GET" | "POST" | "DELETE",
  path: string,
  params: Record<string, unknown> = {},
): Promise<T> {
  const url = path.startsWith("http") ? path : `${BASE}/${path.replace(/^\//, "")}`;
  const delays = [2000, 6000];

  for (let attempt = 0; ; attempt++) {
    const body = encode(params);
    const res =
      method === "GET"
        ? await fetch(`${url}${url.includes("?") ? "&" : "?"}${body}`, { cache: "no-store" })
        : await fetch(url, {
            method,
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body,
          });

    const json = (await res.json().catch(() => ({}))) as {
      error?: {
        message: string;
        code?: number;
        error_subcode?: number;
        error_user_msg?: string;
        is_transient?: boolean;
        fbtrace_id?: string;
      };
    } & T;

    if (res.ok && !json.error) return json as T;

    const err = json.error;
    const creates = method === "POST" && CREATES.test(path);
    const retryable = creates
      ? !!(err?.code && THROTTLE_CODES.has(err.code))
      : res.status >= 500 || err?.is_transient || (err?.code && RETRYABLE_CODES.has(err.code));
    if (retryable && attempt < delays.length) {
      await sleep(delays[attempt]);
      continue;
    }
    throw new MetaApiError(
      err?.message ?? `Meta API ${res.status}`,
      res.status,
      err?.code,
      err?.error_subcode,
      err?.error_user_msg,
      err?.fbtrace_id,
    );
  }
}

/** Follows `paging.next` cursors and concatenates `data` arrays. */
export async function graphAll<T>(path: string, params: Record<string, unknown> = {}, maxPages = 20): Promise<T[]> {
  const rows: T[] = [];
  let page = await graph<{ data: T[]; paging?: { next?: string } }>("GET", path, params);
  rows.push(...page.data);
  for (let i = 1; i < maxPages && page.paging?.next; i++) {
    // `next` already carries every parameter except the token, which graph() re-adds
    const next = new URL(page.paging.next);
    next.searchParams.delete("access_token");
    next.searchParams.delete("appsecret_proof");
    page = await graph<{ data: T[]; paging?: { next?: string } }>("GET", next.toString());
    rows.push(...page.data);
  }
  return rows;
}

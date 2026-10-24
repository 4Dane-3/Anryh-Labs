import { getCurrentAgent } from "@/lib/auth";
import { reportIssue } from "@/lib/admin/errors";
import type { IssueKind } from "@/lib/admin/error-core";

// Errors seen in a browser (a crash page, a script error, a failed save). Public, so it's guarded: same
// site only, small bodies, a per-visitor and a global rate limit, and errors are grouped so a flood
// of the same one only touches one alert.
const KINDS = new Set<IssueKind>(["boundary", "window", "rejection", "action"]);
const MAX_BYTES = 8_000;
const PER_VISITOR_PER_MIN = 15;
const GLOBAL_PER_MIN = 120;

const hits = new Map<string, number[]>();
let global: number[] = [];

function limited(ip: string) {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < 60_000);
  global = global.filter((t) => now - t < 60_000);
  if (recent.length >= PER_VISITOR_PER_MIN || global.length >= GLOBAL_PER_MIN) return true;
  hits.set(ip, [...recent, now]);
  global.push(now);
  if (hits.size > 5000) hits.clear();
  return false;
}

const str = (v: unknown, n: number) => (typeof v === "string" ? v.slice(0, n) : null);

export async function POST(req: Request) {
  const done = new Response(null, { status: 204 });
  const origin = req.headers.get("origin");
  if (origin) {
    try {
      if (new URL(origin).host !== new URL(req.url).host) return done;
    } catch {
      return done;
    }
  }
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (limited(ip)) return done;

  const text = await req.text().catch(() => "");
  if (!text || text.length > MAX_BYTES) return done;
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(text);
  } catch {
    return done;
  }
  const kind = body.kind as IssueKind;
  const path = str(body.path, 300);
  const message = str(body.message, 400);
  if (!KINDS.has(kind) || !path?.startsWith("/") || !message) return done;

  const agent = await getCurrentAgent().catch(() => null);
  await reportIssue({
    kind,
    path,
    message,
    stack: str(body.stack, 800),
    digest: str(body.digest, 60),
    ua: str(body.ua, 160),
    agentId: agent?.id ?? null,
    agentName: agent?.full_name ?? null,
    agentSlug: agent?.slug ?? null,
  });
  return done;
}

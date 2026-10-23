import { supabaseAdmin } from "@/lib/supabase-admin";
import { PAGE_EVENTS, type PageEvent } from "@/lib/booking/track";

// Page analytics for an agent's booking page: a small batch of steps from one visit (see
// lib/booking/track.ts). Only known step names and short, flat details are kept; nothing that
// identifies the visitor.
const NAMES = new Set<string>(PAGE_EVENTS);
const MAX_EVENTS = 30;

function cleanMeta(meta: unknown) {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return {};
  const out: Record<string, string | number | boolean | null> = {};
  for (const [k, v] of Object.entries(meta).slice(0, 8)) {
    if (!/^[a-z_]{1,24}$/.test(k)) continue;
    if (typeof v === "string") out[k] = v.slice(0, 80);
    else if (typeof v === "number" && Number.isFinite(v)) out[k] = Math.round(v);
    else if (typeof v === "boolean" || v === null) out[k] = v;
  }
  return out;
}

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const body = (await req.json().catch(() => null)) as { session?: unknown; events?: unknown } | null;
  const session = typeof body?.session === "string" ? body.session.slice(0, 64) : "";
  const events = Array.isArray(body?.events) ? body.events.slice(0, MAX_EVENTS) : [];
  if (!/^[\w-]{8,64}$/.test(session) || !events.length) return new Response(null, { status: 204 });

  const { data: agent } = await supabaseAdmin.from("agents").select("id").eq("slug", slug).eq("active", true).maybeSingle();
  if (!agent) return new Response(null, { status: 204 });

  const rows = events
    .filter((e): e is { name: PageEvent; meta?: unknown } => !!e && typeof e === "object" && NAMES.has((e as { name?: string }).name ?? ""))
    .map((e) => ({ agent_id: agent.id, session_id: session, name: e.name, meta: cleanMeta(e.meta) }));
  if (rows.length) await supabaseAdmin.from("page_events").insert(rows);
  return new Response(null, { status: 204 });
}

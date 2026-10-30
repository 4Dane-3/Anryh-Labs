import { after } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { PAGE_EVENTS, type PageEvent } from "@/lib/booking/track";
import { sendConversionEvents } from "@/lib/meta/capi";
import { partnerPageUrl } from "@/lib/booking/sites";

// Page analytics for an agent's booking page: a small batch of steps from one visit (see
// lib/booking/track.ts). Only known step names and short, flat details are kept; nothing that
// identifies the visitor.
const NAMES = new Set<string>(PAGE_EVENTS);
const MAX_EVENTS = 30;

// Steps Meta hears about when the visit came from one of our ads (the link's click id): the page opening
// and picking a call time, so it sees more than the rare booking. Organic visits aren't reported.
const TO_META: Partial<Record<PageEvent, "PageView" | "InitiateCheckout">> = { view: "PageView", pick_time: "InitiateCheckout" };

/** The ad click this visit came from, as the page sends it; null when it didn't come from an ad. */
function adClick(raw: unknown) {
  if (!raw || typeof raw !== "object") return null;
  const { fbclid, fbclid_at, page_url } = raw as Record<string, unknown>;
  if (typeof fbclid !== "string" || !/^[\w-]{10,500}$/.test(fbclid)) return null;
  const attribution: Record<string, string> = { fbclid };
  if (typeof fbclid_at === "string" && /^\d{13}$/.test(fbclid_at)) attribution.fbclid_at = fbclid_at;
  return { attribution, pageUrl: page_url };
}

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
  const body = (await req.json().catch(() => null)) as { session?: unknown; events?: unknown; ad?: unknown } | null;
  const session = typeof body?.session === "string" ? body.session.slice(0, 64) : "";
  const events = Array.isArray(body?.events) ? body.events.slice(0, MAX_EVENTS) : [];
  if (!/^[\w-]{8,64}$/.test(session) || !events.length) return new Response(null, { status: 204 });

  const { data: agent } = await supabaseAdmin.from("agents").select("id").eq("slug", slug).eq("active", true).maybeSingle();
  if (!agent) return new Response(null, { status: 204 });

  const rows = events
    .filter((e): e is { name: PageEvent; meta?: unknown } => !!e && typeof e === "object" && NAMES.has((e as { name?: string }).name ?? ""))
    .map((e) => ({ agent_id: agent.id, session_id: session, name: e.name, meta: cleanMeta(e.meta) }));
  if (rows.length) await supabaseAdmin.from("page_events").insert(rows);

  const click = adClick(body?.ad);
  const steps = [...new Set(rows.map((r) => TO_META[r.name]).filter((e) => !!e))];
  if (click && steps.length) {
    const origin = new URL(req.url).origin;
    after(async () => {
      try {
        // One event per step per visit: a reload of the page sends the same id, which Meta dedupes
        for (const event of steps)
          await sendConversionEvents({
            events: [event],
            eventId: `${session}.${event}`,
            pageUrl: partnerPageUrl(click.pageUrl) ?? `${origin}/${slug}`,
            attribution: click.attribution,
            ip: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
            userAgent: req.headers.get("user-agent"),
          });
      } catch (e) {
        console.error("conversions api failed", e);
      }
    });
  }
  return new Response(null, { status: 204 });
}

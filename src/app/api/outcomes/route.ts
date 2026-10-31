import { supabaseAdmin } from "@/lib/supabase-admin";
import { recordOutcome, validSignature } from "@/lib/dashboard/outcomes";
import type { OutcomeKind } from "@/lib/outcomes";

// A one-tap answer from the Slack ask's link page: signed per lead, so it needs no sign-in and can only set
// that lead's outcome. The page posts it from the browser (link previews don't run scripts).
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { kind?: string; id?: string; s?: string; outcome?: string; premium?: number } | null;
  const kind = body?.kind === "call" || body?.kind === "lead" ? (body.kind as OutcomeKind) : null;
  if (!kind || typeof body?.id !== "string" || !validSignature(kind, body.id, body.s ?? null)) return Response.json({ ok: false }, { status: 403 });
  const { data } = await supabaseAdmin.from(kind === "call" ? "bookings" : "quote_requests").select("agent_id").eq("id", body.id).maybeSingle();
  if (!data) return Response.json({ ok: false }, { status: 404 });
  const premium = typeof body.premium === "number" ? Math.round(body.premium * 100) : null;
  const ok = await recordOutcome(data.agent_id, kind, body.id, String(body.outcome ?? ""), premium);
  return Response.json({ ok }, { status: ok ? 200 : 400 });
}

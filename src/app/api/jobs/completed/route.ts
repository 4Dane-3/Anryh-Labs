import { supabaseAdmin } from "@/lib/supabase-admin";
import type { Agent } from "@/lib/booking/data";
import { usPhone } from "@/lib/booking/call";
import { markJobDone } from "@/lib/roofing/checkin";

// "Job completed" from a roofer's CRM (JobNimbus, AccuLynx, Leap…), usually a Zapier step on a status change:
//   POST /api/jobs/completed   header x-job-secret: <their secret from Settings>
//   body { booking_id } or { phone, email } (the customer's), matched to their latest inspection
// Same as tapping "Job done" in the dashboard: the check-in call is scheduled (or the referral email sent).
export const runtime = "nodejs";
export const preferredRegion = "iad1";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: Request) {
  const secret = req.headers.get("x-job-secret") ?? req.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  if (!UUID.test(secret)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { data: agent } = await supabaseAdmin.from("agents").select("*").eq("job_webhook_token", secret).maybeSingle();
  if (!agent) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const body = ((await req.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  let bookingId = typeof body.booking_id === "string" && UUID.test(body.booking_id) ? body.booking_id : null;
  if (!bookingId) {
    const phone = typeof body.phone === "string" ? usPhone(body.phone) : null;
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    if (!phone && !email) return Response.json({ error: "Send booking_id, or the customer's phone or email." }, { status: 400 });
    const filters = [phone && `phone.eq."${phone}"`, email && /^[^\s@,()"]+@[^\s@,()"]+\.[^\s@,()"]+$/.test(email) && `email.ilike."${email}"`].filter(Boolean).join(",");
    if (!filters) return Response.json({ error: "Send booking_id, or the customer's phone or email." }, { status: 400 });
    const { data: match } = await supabaseAdmin
      .from("bookings")
      .select("id")
      .eq("agent_id", agent.id)
      .eq("status", "confirmed")
      .lte("starts_at", new Date().toISOString())
      .or(filters)
      .order("starts_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    bookingId = match?.id ?? null;
  }
  if (!bookingId) return Response.json({ error: "No past inspection matches that customer." }, { status: 404 });

  const res = await markJobDone(agent as Agent, bookingId, "webhook");
  if (!res.ok) return Response.json({ error: res.error }, { status: res.status });
  return Response.json({ ok: true, booking_id: bookingId, already: res.already, checkin: res.status, call_at: res.callAt, reason: res.reason });
}

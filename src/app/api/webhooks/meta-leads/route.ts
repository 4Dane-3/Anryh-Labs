import { createHmac, timingSafeEqual } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase-admin";
import type { Agent } from "@/lib/booking/data";
import { receiveLead } from "@/lib/migz/leads";

export const maxDuration = 60;

// Meta's leadgen webhook: an instant-form lead was submitted on an agent's Page. Subscribe the app's Page
// webhook to the "leadgen" field with META_WEBHOOK_VERIFY_TOKEN as the verify token. The payload only
// carries the lead's id, so the lead itself is fetched from Meta (receiveLead); the sync also polls each
// form, so a missed or failed delivery is picked up within hours.

/** Meta's subscription check: echo the challenge when the verify token matches. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const expected = process.env.META_WEBHOOK_VERIFY_TOKEN;
  if (expected && url.searchParams.get("hub.mode") === "subscribe" && url.searchParams.get("hub.verify_token") === expected)
    return new Response(url.searchParams.get("hub.challenge") ?? "", { status: 200 });
  return new Response("Forbidden", { status: 403 });
}

function validSignature(raw: string, header: string | null) {
  const secret = process.env.META_APP_SECRET;
  if (!secret || !header?.startsWith("sha256=")) return false;
  const expected = Buffer.from(`sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`);
  const given = Buffer.from(header);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

type Change = { field?: string; value?: { leadgen_id?: string; page_id?: string; form_id?: string } };

export async function POST(req: Request) {
  const raw = await req.text();
  if (!validSignature(raw, req.headers.get("x-hub-signature-256"))) return new Response("Forbidden", { status: 403 });
  const body = JSON.parse(raw || "{}") as { entry?: { changes?: Change[] }[] };

  let saved = 0;
  for (const change of (body.entry ?? []).flatMap((e) => e.changes ?? [])) {
    const v = change.value;
    if (change.field !== "leadgen" || !v?.leadgen_id) continue;
    // The form says whose lead it is (a Page can serve several agents' forms); the Page is the fallback
    let agent: Agent | null = null;
    if (v.form_id) agent = ((await supabaseAdmin.from("agents").select("*").eq("meta_lead_form_id", v.form_id).maybeSingle()).data as Agent | null) ?? null;
    if (!agent && v.page_id) {
      const { data } = await supabaseAdmin.from("agents").select("*").eq("meta_page_id", v.page_id).limit(2);
      if (data?.length === 1) agent = data[0] as Agent;
    }
    if (!agent) continue;
    try {
      if (await receiveLead(agent, v.leadgen_id)) saved++;
    } catch (e) {
      // 200 anyway: Meta retries failures for hours, and the sync's poll will pick this lead up
      console.error("saving a form lead failed", e);
    }
  }
  return Response.json({ ok: true, saved });
}

import { createHmac, timingSafeEqual } from "node:crypto";
import { after } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import type { Agent } from "@/lib/booking/data";
import { handleInbound } from "@/lib/migz/chat";

export const maxDuration = 60;

function validSlack(secret: string, ts: string, body: string, given: string) {
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false;
  const a = Buffer.from(`v0=${createHmac("sha256", secret).update(`v0:${ts}:${body}`).digest("hex")}`);
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}

// A client sent Migz a Slack DM. Needs SLACK_SIGNING_SECRET and the Slack app's Events API (message.im).
export async function POST(req: Request) {
  const secret = process.env.SLACK_SIGNING_SECRET;
  if (!secret) return new Response("Not set up", { status: 503 });
  const body = await req.text();
  if (!validSlack(secret, req.headers.get("x-slack-request-timestamp") ?? "0", body, req.headers.get("x-slack-signature") ?? "")) return new Response("Forbidden", { status: 403 });
  const payload = JSON.parse(body) as { type: string; challenge?: string; event_id?: string; event?: { type: string; channel_type?: string; user?: string; text?: string; bot_id?: string; subtype?: string } };
  if (payload.type === "url_verification") return Response.json({ challenge: payload.challenge });
  const e = payload.event;
  if (e?.type === "message" && e.channel_type === "im" && e.user && e.text && !e.bot_id && !e.subtype) {
    const { data: agent } = await supabaseAdmin.from("agents").select("*").eq("slack_user_id", e.user).maybeSingle();
    if (agent) after(() => handleInbound(agent as Agent, "slack", e.text!, `slack:${payload.event_id}`).catch((err) => console.error("slack chat failed", err)));
  }
  return new Response("ok");
}

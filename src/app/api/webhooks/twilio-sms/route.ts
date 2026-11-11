import { after } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import type { Agent } from "@/lib/booking/data";
import { handleInbound } from "@/lib/migz/chat";
import { validTwilioSignature } from "@/lib/migz/sms";

export const maxDuration = 60;

const EMPTY = new Response("<Response></Response>", { headers: { "Content-Type": "text/xml" } });

// A client texted Migz. Twilio's webhook points here; the reply goes out separately once this has answered.
export async function POST(req: Request) {
  const token = process.env.TWILIO_AUTH_TOKEN;
  const base = process.env.APP_URL?.replace(/\/$/, "");
  if (!token || !base) return new Response("Not set up", { status: 503 });
  const form = Object.fromEntries((await req.formData()).entries()) as Record<string, string>;
  if (!validTwilioSignature(token, `${base}/api/webhooks/twilio-sms`, form, req.headers.get("x-twilio-signature") ?? "")) return new Response("Forbidden", { status: 403 });
  const { data: agent } = await supabaseAdmin.from("agents").select("*").eq("sms_phone", form.From ?? "").maybeSingle();
  if (agent && form.Body && form.MessageSid) after(() => handleInbound(agent as Agent, "sms", form.Body, `sms:${form.MessageSid}`).catch((e) => console.error("sms chat failed", e)));
  return EMPTY;
}

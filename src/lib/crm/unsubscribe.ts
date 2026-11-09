import "server-only";
import { supabaseAdmin } from "@/lib/supabase-admin";

// A client's unsubscribe from follow-up emails, by the unguessable token in the link. Stops any sequence.

export const validToken = (t: unknown): t is string => typeof t === "string" && /^[a-f0-9]{32,128}$/.test(t);

export async function clientByEmailToken(token: string) {
  if (!validToken(token)) return null;
  const { data } = await supabaseAdmin.from("crm_clients").select("id, name, company, unsubscribed_at").eq("email_token", token).maybeSingle();
  return data as { id: string; name: string | null; company: string | null; unsubscribed_at: string | null } | null;
}

export async function unsubscribe(token: string) {
  const c = await clientByEmailToken(token);
  if (!c) return false;
  const now = new Date().toISOString();
  if (!c.unsubscribed_at) await supabaseAdmin.from("crm_clients").update({ unsubscribed_at: now, updated_at: now }).eq("id", c.id);
  await supabaseAdmin.from("crm_followups").update({ status: "stopped", stop_reason: "They unsubscribed", next_send_at: null, updated_at: now }).eq("client_id", c.id).in("status", ["active", "paused"]);
  await supabaseAdmin.from("crm_notes").insert({ client_id: c.id, body: "Unsubscribed from follow-up emails.", author: "client" });
  return true;
}

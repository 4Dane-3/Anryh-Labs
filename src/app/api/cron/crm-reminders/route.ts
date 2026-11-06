import { isCronRequest } from "@/lib/cron-auth";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getSettings } from "@/lib/crm/data";
import { sendMeetingEmail } from "@/lib/crm/email";
import type { CrmMeeting } from "@/lib/crm/types";

export const maxDuration = 60;

// Every 15 minutes (pg_cron): emails a reminder to each client whose CRM meeting starts within the next
// 24 hours, once per meeting time. Skipped when the invite itself went out less than 6 hours ago (it's
// fresh in their inbox). Unconfirmed clients get the Confirm button again.
export async function GET(req: Request) {
  if (!isCronRequest(req)) return new Response("Unauthorized", { status: 401 });
  const now = Date.now();
  const { data, error } = await supabaseAdmin
    .from("crm_meetings")
    .select("*, client:crm_clients(name, company, email)")
    .in("status", ["invited", "confirmed"])
    .is("reminder_sent_at", null)
    .gt("starts_at", new Date(now + 30 * 60_000).toISOString())
    .lte("starts_at", new Date(now + 24 * 3_600_000).toISOString())
    .lt("invited_at", new Date(now - 6 * 3_600_000).toISOString());
  if (error) return Response.json({ error: error.message }, { status: 500 });
  const settings = await getSettings();
  let sent = 0;
  for (const m of (data ?? []) as (CrmMeeting & { client: { name: string; email: string | null } })[]) {
    if (!m.client.email) continue;
    try {
      // Claim it first so an overlapping run can't send it twice
      const { data: claimed } = await supabaseAdmin.from("crm_meetings").update({ reminder_sent_at: new Date().toISOString() }).eq("id", m.id).is("reminder_sent_at", null).select("id").maybeSingle();
      if (!claimed) continue;
      await sendMeetingEmail({ kind: "reminder", meeting: m, client: { name: m.client.name, email: m.client.email }, settings });
      sent++;
    } catch (e) {
      console.error("crm reminder failed", m.id, e);
      await supabaseAdmin.from("crm_meetings").update({ reminder_sent_at: null }).eq("id", m.id);
    }
  }
  return Response.json({ due: data?.length ?? 0, sent });
}

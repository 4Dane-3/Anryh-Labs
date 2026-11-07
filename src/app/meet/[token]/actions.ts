"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getMeetingByToken, getSettings } from "@/lib/crm/data";
import { whenText } from "@/lib/crm/invite-email";
import { clientLabel, dayIn } from "@/lib/crm/types";
import { sendSlackMessage } from "@/lib/slack";

// The client's answer to a CRM meeting invite. Public: the unguessable token in the link is the only
// key. A POST (a button press), never a GET, so email link scanners that open every link can't confirm
// or cancel on the client's behalf.

async function tellStaff(text: string) {
  const to = process.env.ANRYH_ALERT_SLACK_ID;
  if (process.env.NODE_ENV !== "production" || !to || !process.env.SLACK_BOT_TOKEN) return;
  await sendSlackMessage(to, text).catch((e) => console.error("crm slack ping failed", e));
}

export async function respondToMeeting(token: string, answer: "confirm" | "decline" | "reschedule") {
  const m = await getMeetingByToken(token);
  if (!m || m.status === "cancelled") return;
  // After a no-show, the rebook email links here: the client asks for another time, and staff get a task
  if (answer === "reschedule") {
    if (m.outcome !== "no_show" || m.reschedule_requested_at) return;
    const { data: claimed } = await supabaseAdmin.from("crm_meetings").update({ reschedule_requested_at: new Date().toISOString() }).eq("id", m.id).is("reschedule_requested_at", null).select("id").maybeSingle();
    if (claimed) {
      const settings = await getSettings();
      await supabaseAdmin.from("crm_tasks").insert({ client_id: m.client_id, meeting_id: m.id, title: `${clientLabel(m.client)} asked for a new time: schedule it`, due_on: dayIn(settings.timezone, Date.now()), created_by: "client" });
      await tellStaff(`🔁 *${clientLabel(m.client)}* missed *${m.title}* and asked for another time. Reach out to set it up.`);
    }
    revalidatePath(`/meet/${token}`);
    revalidatePath("/admin/clients");
    revalidatePath(`/admin/clients/${m.client_id}`);
    return;
  }
  if (new Date(m.ends_at) < new Date()) return;
  if (answer === "confirm" && m.status !== "confirmed") {
    await supabaseAdmin.from("crm_meetings").update({ status: "confirmed", confirmed_at: new Date().toISOString() }).eq("id", m.id).neq("status", "cancelled");
    await tellStaff(`✅ *${clientLabel(m.client)}* confirmed *${m.title}* · ${whenText(m).short}`);
  } else if (answer === "decline") {
    await supabaseAdmin.from("crm_meetings").update({ status: "cancelled", cancelled_at: new Date().toISOString(), cancelled_by: "client" }).eq("id", m.id);
    await tellStaff(`❌ *${clientLabel(m.client)}* can't make *${m.title}* · ${whenText(m).short}. Reach out to find another time.`);
  }
  revalidatePath(`/meet/${token}`);
  revalidatePath("/admin/calendar");
  revalidatePath(`/admin/clients/${m.client_id}`);
}

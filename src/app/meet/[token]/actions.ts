"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getMeetingByToken } from "@/lib/crm/data";
import { whenText } from "@/lib/crm/invite-email";
import { clientLabel } from "@/lib/crm/types";
import { sendSlackMessage } from "@/lib/slack";

// The client's answer to a CRM meeting invite. Public: the unguessable token in the link is the only
// key. A POST (a button press), never a GET, so email link scanners that open every link can't confirm
// or cancel on the client's behalf.

async function tellStaff(text: string) {
  const to = process.env.ANRYH_ALERT_SLACK_ID;
  if (process.env.NODE_ENV !== "production" || !to || !process.env.SLACK_BOT_TOKEN) return;
  await sendSlackMessage(to, text).catch((e) => console.error("crm slack ping failed", e));
}

export async function respondToMeeting(token: string, answer: "confirm" | "decline") {
  const m = await getMeetingByToken(token);
  if (!m || m.status === "cancelled" || new Date(m.ends_at) < new Date()) return;
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

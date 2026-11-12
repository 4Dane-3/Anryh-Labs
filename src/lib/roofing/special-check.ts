import "server-only";
import { supabaseAdmin } from "@/lib/supabase-admin";
import type { Agent } from "@/lib/booking/data";
import { resend } from "@/lib/roofing/notify";
import { sendSlackMessage } from "@/lib/slack";
import { applyPayload } from "@/lib/migz/executor";
import type { ActionPayload } from "@/lib/migz/tools";
import { promotes, specialCheckDue, specialEmail, specialMarkers } from "@/lib/roofing/special-rules";

// Every week Migz asks each running roofer whether the special their ads feature is still on. "Still running"
// confirms it for another week; "It's ended" takes it off and, if they want, pauses the live ads that promote it
// so Migz makes new ones with the new special. Asking is the only thing done without them: nothing is paused
// until they answer.

const appUrl = () => (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");

/** The weekly asks for everyone due (called from the Migz cron). */
export async function sendSpecialChecks(deadline: number) {
  const { data: rows, error } = await supabaseAdmin
    .from("agent_brand")
    .select("agent_id, deals, special_asked_at, special_confirmed_at, agents!inner(id, full_name, email, business_email, slack_user_id, active, vertical, onboarding_completed_at)")
    .neq("deals", "{}");
  if (error) throw new Error(error.message);
  const sent: Record<string, string> = {};
  for (const row of (rows ?? []) as unknown as {
    agent_id: string;
    deals: string[];
    special_asked_at: string | null;
    special_confirmed_at: string | null;
    agents: Pick<Agent, "id" | "full_name" | "email" | "business_email" | "slack_user_id" | "vertical" | "onboarding_completed_at"> & { active: boolean };
  }[]) {
    if (Date.now() > deadline) break;
    const a = row.agents;
    if (!a.active || a.vertical !== "roofing" || !a.onboarding_completed_at || !specialCheckDue(row)) continue;
    const special = row.deals[0];
    const email = specialEmail(a, special);
    try {
      const week = new Date().toISOString().slice(0, 10);
      await resend({ to: [a.business_email || a.email], subject: email.subject, html: email.html, text: email.text }, `special-check/${a.id}/${week}`);
      if (a.slack_user_id && process.env.SLACK_BOT_TOKEN)
        await sendSlackMessage(a.slack_user_id, `Is your special still running? Your ads feature "${special}". Confirm it or give the new one: ${appUrl()}/dashboard/special`).catch(() => null);
      await supabaseAdmin.from("agent_brand").update({ special_asked_at: new Date().toISOString() }).eq("agent_id", a.id);
      sent[a.id] = "asked";
    } catch (e) {
      sent[a.id] = `failed: ${e instanceof Error ? e.message.slice(0, 120) : "error"}`;
    }
  }
  return sent;
}

/** The live ads whose text promotes this special. */
export async function adsPromoting(agentId: string, special: string) {
  const markers = specialMarkers(special);
  const { data } = await supabaseAdmin.from("ads").select("meta_ad_id, name, primary_text, headline, status").eq("agent_id", agentId).eq("status", "ACTIVE");
  return (data ?? []).filter((ad) => promotes(`${ad.name ?? ""} ${ad.primary_text ?? ""} ${ad.headline ?? ""}`, markers));
}

/** Pauses the live ads promoting an ended special. Returns how many. */
export async function pauseAdsPromoting(agent: Agent, special: string) {
  const ads = await adsPromoting(agent.id, special);
  let paused = 0;
  for (const ad of ads) {
    const payload: ActionPayload = { tool: "pause_ad", ad_id: ad.meta_ad_id };
    const r = await applyPayload(agent, payload, null, { title: "Pausing an ad for an ended special" }).catch(() => null);
    if (r?.ok) paused++;
  }
  return paused;
}

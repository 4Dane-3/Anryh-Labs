import "server-only";
import { supabaseAdmin } from "@/lib/supabase-admin";
import type { Agent } from "@/lib/booking/data";
import { isRoofer } from "@/lib/verticals";

// One less thing to answer: a roofer still in setup starts with sensible choices already made (Migz makes the
// ads and runs them, the booking page is ours, weekday hours), so those steps tick themselves off. Each only
// fills what's empty and can be changed later. Finished accounts are never touched.

export async function applyRooferDefaults(agent: Agent): Promise<Agent> {
  if (!isRoofer(agent) || agent.onboarding_completed_at) return agent;
  const patch: Record<string, unknown> = {};
  if (!agent.creative_mode) patch.creative_mode = "ai";
  if (!agent.migz_mode_chosen_at) Object.assign(patch, { migz_mode: "auto", migz_mode_chosen_at: new Date().toISOString() });
  if (!agent.booking_choice) patch.booking_choice = "ours";
  if (!agent.bio && agent.full_name?.trim()) patch.bio = `${agent.full_name.trim()} is a local roofing company${agent.service_area ? ` serving ${agent.service_area}` : ""}. Book a free roof inspection and we'll tell you exactly what shape your roof is in.`;

  const { count } = await supabaseAdmin.from("availability_rules").select("id", { count: "exact", head: true }).eq("agent_id", agent.id);
  if (!count && (agent.booking_choice ?? "ours") === "ours")
    await supabaseAdmin.from("availability_rules").insert([1, 2, 3, 4, 5].map((weekday) => ({ agent_id: agent.id, weekday, start_time: "08:00", end_time: "17:00" })));

  if (!Object.keys(patch).length) return agent;
  const { error } = await supabaseAdmin.from("agents").update(patch).eq("id", agent.id);
  return error ? agent : ({ ...agent, ...patch } as Agent);
}

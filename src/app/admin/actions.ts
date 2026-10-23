"use server";

import { revalidatePath } from "next/cache";
import { isAnryhAdmin } from "@/lib/auth";
import { createSupabaseServer } from "@/lib/supabase-server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { scanAll } from "@/lib/admin/health";

type Result = { ok: true; message?: string } | { ok: false; error: string };

async function staffEmail() {
  if (!(await isAnryhAdmin())) return null;
  const { data } = await (await createSupabaseServer()).auth.getUser();
  return data.user?.email ?? "staff";
}

/** Marks an alert handled. If the problem is still there, it won't alert again for a day. */
export async function resolveAlert(id: number): Promise<Result> {
  const who = await staffEmail();
  if (!who) return { ok: false, error: "Staff only." };
  const { error } = await supabaseAdmin.from("admin_alerts").update({ resolved_at: new Date().toISOString(), resolved_by: who }).eq("id", id).is("resolved_at", null);
  if (error) return { ok: false, error: "Couldn't update that alert." };
  revalidatePath("/admin");
  return { ok: true };
}

/** The monthly AI budget for one agent. Over it, Migz moves work to cheaper models instead of stopping. */
export async function setAgentModelBudget(agentId: string, cents: number): Promise<Result> {
  if (!(await staffEmail())) return { ok: false, error: "Staff only." };
  if (!Number.isInteger(cents) || cents < 0 || cents > 100_000) return { ok: false, error: "Enter a budget between $0 and $1,000." };
  const { error } = await supabaseAdmin.from("agents").update({ migz_model_budget_cents: cents }).eq("id", agentId);
  if (error) return { ok: false, error: "Couldn't save that budget." };
  revalidatePath("/admin");
  return { ok: true };
}

/** Runs the health scan now instead of waiting for the next 10-minute check. */
export async function scanNow(): Promise<Result> {
  if (!(await staffEmail())) return { ok: false, error: "Staff only." };
  const r = await scanAll(Date.now() + 50_000);
  revalidatePath("/admin");
  if ("skipped" in r) return { ok: false, error: "Run the admin_alerts migration first." };
  return { ok: true, message: r.new ? `${r.new} new problem${r.new === 1 ? "" : "s"} found${r.pinged ? ", Slack pinged" : ""}.` : "Scanned every account: nothing new." };
}

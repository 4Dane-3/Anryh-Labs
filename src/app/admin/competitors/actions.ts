"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { isAnryhAdmin } from "@/lib/auth";
import { createSupabaseServer } from "@/lib/supabase-server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import type { Agent } from "@/lib/booking/data";
import { isRoofer } from "@/lib/verticals";
import { advanceRun, createRun } from "@/lib/competitors/pipeline";
import { publishPaused } from "@/lib/competitors/publish";
import { getRun, saveRun, type Run } from "@/lib/competitors/store";

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

async function staff() {
  if (!(await isAnryhAdmin())) return null;
  const { data } = await (await createSupabaseServer()).auth.getUser();
  return data.user?.email ?? "staff";
}

/** Starts Migz's competitor research for a roofer. The Apify spend is capped at `budgetUsd`. */
export async function startResearch(input: { agentId: string; budgetUsd: number; benchmark: string; small?: boolean }): Promise<Result<{ id: string }>> {
  const who = await staff();
  if (!who) return { ok: false, error: "Staff only." };
  const { data: agent } = await supabaseAdmin.from("agents").select("*").eq("id", input.agentId).maybeSingle();
  if (!agent || !isRoofer(agent as Agent)) return { ok: false, error: "Pick a roofing company." };
  const r = await createRun(agent as Agent, { budgetUsd: Number(input.budgetUsd) || 10, benchmark: input.benchmark.trim() || null, by: who, small: !!input.small });
  if (!r.ok) return r;
  after(() => advanceRun(r.id).then(() => undefined, () => undefined));
  revalidatePath("/admin/competitors");
  return { ok: true, id: r.id };
}

/** The page calls this every few seconds while a run is going: it moves the run along and returns it. */
export async function advanceResearch(runId: string): Promise<Result<{ run: Run }>> {
  if (!(await staff())) return { ok: false, error: "Staff only." };
  const run = await getRun(runId);
  if (!run) return { ok: false, error: "That run is gone." };
  if (run.status !== "running") return { ok: true, run };
  const moved = await advanceRun(runId, Date.now() + 50_000);
  return moved ? { ok: true, run: moved } : { ok: false, error: "That run is gone." };
}

export async function cancelResearch(runId: string): Promise<Result> {
  if (!(await staff())) return { ok: false, error: "Staff only." };
  await saveRun(runId, { status: "canceled", finished_at: new Date().toISOString() });
  revalidatePath("/admin/competitors");
  return { ok: true };
}

/** Puts the winning ad into the roofer's Google Ads, paused. Refused unless the 9/10 gate passed. */
export async function publishResearch(runId: string): Promise<Result<{ message: string }>> {
  if (!(await staff())) return { ok: false, error: "Staff only." };
  const r = await publishPaused(runId);
  if (!r.ok) return r;
  revalidatePath("/admin/competitors");
  return { ok: true, message: r.published.validateOnly ? "Google checked it (validate-only mode): nothing was created." : `Added to "${r.published.campaignName}", paused. Review it in Google Ads before switching it on.` };
}

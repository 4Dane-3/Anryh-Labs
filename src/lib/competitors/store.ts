import "server-only";
import { supabaseAdmin } from "@/lib/supabase-admin";
import type { AdContext } from "@/lib/competitors/types";

export { STAGES, type Job, type Run, type Stage } from "@/lib/competitors/run-types";
import type { Run } from "@/lib/competitors/run-types";

export const MIGRATION_HINT = "Competitor research isn't switched on yet: run migration 20261215000000_competitor_research.sql.";

export async function getRun(id: string): Promise<Run | null> {
  const { data } = await supabaseAdmin.from("competitor_runs").select("*").eq("id", id).maybeSingle();
  return (data as Run | null) ?? null;
}

/** The roofer's newest run (or null; also null before the migration). */
export async function latestRun(agentId: string, opts: { done?: boolean } = {}): Promise<Run | null> {
  let q = supabaseAdmin.from("competitor_runs").select("*").eq("agent_id", agentId).order("created_at", { ascending: false }).limit(1);
  if (opts.done) q = q.eq("status", "done");
  const { data, error } = await q.maybeSingle();
  if (error) return null;
  return (data as Run | null) ?? null;
}

export async function saveRun(id: string, fields: Partial<Run>) {
  await supabaseAdmin.from("competitor_runs").update({ ...fields, updated_at: new Date().toISOString() }).eq("id", id);
}

export async function getAdContext(agentId: string): Promise<AdContext | null> {
  const { data, error } = await supabaseAdmin.from("agent_ad_context").select("context").eq("agent_id", agentId).maybeSingle();
  if (error) return null;
  return ((data?.context as AdContext | undefined) ?? null) || null;
}

export async function saveAdContext(agentId: string, context: AdContext) {
  await supabaseAdmin.from("agent_ad_context").upsert({ agent_id: agentId, context, built_at: context.builtAt }, { onConflict: "agent_id" });
}

export const logLine = (run: Pick<Run, "log">, text: string) => [...(run.log ?? []), { at: new Date().toISOString(), text }].slice(-80);

import "server-only";
import { supabaseAdmin } from "@/lib/supabase-admin";
import type { Agent } from "@/lib/booking/data";
import { apifyReady } from "@/lib/apify";
import { checkAdText } from "@/lib/google-ads/guardrails";
import { createRun, advanceRun } from "@/lib/competitors/pipeline";
import { usableLanding, winningAd, type ResearchLanding, type ResearchState } from "@/lib/competitors/live-copy";
import type { Drafts } from "@/lib/competitors/types";

// Competitor research feeding the live campaign (see live-copy.ts for the rules).

/** The research the first build waits on: the newest run that is running or done. */
export async function researchState(agentId: string): Promise<ResearchState> {
  const { data, error } = await supabaseAdmin.from("competitor_runs").select("status, created_at").eq("agent_id", agentId).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (error || !data) return { status: "none" };
  if (data.status === "running") return { status: "running", startedAt: data.created_at as string };
  return data.status === "done" ? { status: "done" } : { status: "failed" };
}

/** Starts research for a roofer who just turned Google on. Nothing happens without Apify configured. */
export async function startResearchFor(agent: Agent): Promise<boolean> {
  if (!apifyReady()) return false;
  const r = await createRun(agent, { budgetUsd: 10, benchmark: "Dublin, Ireland", by: "migz (Google turned on)" });
  if (!r.ok) {
    console.error("[competitors] auto start failed", r.error);
    return false;
  }
  // The cron moves it along from here; this only gets the first jobs going
  await advanceRun(r.id, Date.now() + 20_000).catch(() => null);
  return true;
}

async function latestDrafts(agentId: string): Promise<Drafts | null> {
  const { data, error } = await supabaseAdmin.from("competitor_runs").select("drafts").eq("agent_id", agentId).eq("status", "done").not("drafts", "is", null).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (error || !data) return null;
  return (data.drafts as Drafts | null) ?? null;
}

/** The ad that beat the competitors, checked against Google's rules, or null. */
export async function researchAd(agentId: string) {
  const ad = winningAd(await latestDrafts(agentId));
  if (!ad || checkAdText(ad.headlines, ad.descriptions, ad.path1, ad.path2)) return null;
  return ad;
}

/** The landing page copy that beat the competitors' pages, or null. */
export async function researchLanding(agentId: string): Promise<ResearchLanding | null> {
  return usableLanding(await latestDrafts(agentId));
}

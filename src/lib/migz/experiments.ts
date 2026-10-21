import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { supabaseAdmin } from "@/lib/supabase-admin";
import type { Agent } from "@/lib/booking/data";
import { emit } from "@/lib/migz/events";
import { derive, emptyTotals, present, type Derived } from "@/lib/migz/metrics";
import type { ExtraTool } from "@/lib/migz/operator";
import type { Snapshot } from "@/lib/migz/snapshot";

// The experiment ledger and the learnings library. Per agent only: nothing here reads another
// agent's rows, and our privacy policy says an agent's Meta data is used only to serve that agent.

export const MAX_CONCURRENT_EXPERIMENTS = 2;
export const MIN_IMPRESSIONS_PER_VARIANT = 1000;
export const LEVERS = ["hook", "body", "copy", "offer", "format", "placement", "budget"] as const;
export const METRICS = ["cost_per_booked_call", "hook_rate", "hold_rate", "link_ctr", "visit_to_booking"] as const;

export type Variant = { label: string; ad_id: string | null; creative_job_id: string | null };
export type Experiment = {
  id: string;
  hypothesis: string;
  rationale: string;
  lever: string;
  success_metric: (typeof METRICS)[number];
  variants: Variant[];
  min_impressions: number;
  min_thruplays: number;
  status: "planned" | "running" | "concluded";
  created_at: string;
};

export type VariantProgress = { label: string; ad_id: string | null; impressions: number; thruplays: number; ready: boolean; metrics: Derived | null };

/** Per-variant sample and metrics from the snapshot. Pure, so the "never end early" rule is testable. */
export function progress(exp: Pick<Experiment, "variants" | "min_impressions" | "min_thruplays">, adMetrics: Snapshot["adMetrics"]): VariantProgress[] {
  return exp.variants.map((v) => {
    const m = v.ad_id ? adMetrics.get(v.ad_id) : undefined;
    const t = m?.t.d14 ?? emptyTotals();
    return {
      label: v.label,
      ad_id: v.ad_id,
      impressions: t.impressions,
      thruplays: t.thruplays,
      ready: !!v.ad_id && t.impressions >= exp.min_impressions && t.thruplays >= exp.min_thruplays,
      metrics: m ? derive(t) : null,
    };
  });
}

export const allReady = (p: VariantProgress[]) => p.length >= 2 && p.every((v) => v.ready);

/** Resolves variants that were waiting on a creative job to the ad that job launched. */
async function resolveVariants(agentId: string, variants: Variant[]) {
  let changed = false;
  for (const v of variants) {
    if (v.ad_id || !v.creative_job_id) continue;
    const { data: job } = await supabaseAdmin.from("creative_jobs").select("creative_id, stage").eq("id", v.creative_job_id).eq("agent_id", agentId).maybeSingle();
    if (job?.stage !== "launched" || !job.creative_id) continue;
    const { data: ad } = await supabaseAdmin.from("ads").select("meta_ad_id").eq("agent_id", agentId).eq("creative_id", job.creative_id).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (ad) {
      v.ad_id = ad.meta_ad_id;
      changed = true;
    }
  }
  return changed;
}

/** Each review: promote planned experiments whose variants are all live, and report which are ready for a verdict. */
export async function experimentContext(agent: Agent, snapshot: Snapshot) {
  const [{ data: open }, { data: learnings }] = await Promise.all([
    supabaseAdmin.from("experiments").select("*").eq("agent_id", agent.id).in("status", ["planned", "running"]).order("created_at"),
    supabaseAdmin.from("learnings").select("insight, confidence, source, created_at").eq("agent_id", agent.id).eq("active", true).order("created_at", { ascending: false }).limit(20),
  ]);
  const live = [];
  let ready = 0;
  for (const exp of (open ?? []) as Experiment[]) {
    const changed = await resolveVariants(agent.id, exp.variants);
    let status = exp.status;
    if (status === "planned" && exp.variants.every((v) => v.ad_id)) status = "running";
    if (changed || status !== exp.status)
      await supabaseAdmin.from("experiments").update({ variants: exp.variants, status, ...(status === "running" && exp.status === "planned" ? { started_at: new Date().toISOString() } : {}) }).eq("id", exp.id);
    const p = progress(exp, snapshot.adMetrics);
    const isReady = status === "running" && allReady(p);
    if (isReady) ready++;
    live.push({
      experiment_id: exp.id,
      hypothesis: exp.hypothesis,
      lever: exp.lever,
      success_metric: exp.success_metric,
      status,
      ready_for_verdict: isReady,
      variants: p.map((v) => ({ label: v.label, ad_id: v.ad_id, impressions: v.impressions, thruplays: v.thruplays, needs: `${exp.min_impressions} impressions${exp.min_thruplays ? `, ${exp.min_thruplays} ThruPlays` : ""}`, results: v.metrics ? present(v.metrics) : null })),
    });
  }
  const rank = { high: 0, medium: 1, low: 2 } as Record<string, number>;
  const top = (learnings ?? []).sort((a, b) => rank[a.confidence] - rank[b.confidence]).slice(0, 8);
  return {
    context: { live_experiments: live, top_learnings: top.map((l) => ({ insight: l.insight, confidence: l.confidence, source: l.source })) },
    reasons: ready ? [`${ready} experiment(s) ready for a verdict`] : [],
  };
}

function tool(name: string, description: string, properties: Record<string, unknown>): Anthropic.Beta.BetaTool {
  return { name, description, strict: false, input_schema: { type: "object", properties, required: Object.keys(properties), additionalProperties: false } };
}

const variantSchema = {
  type: "object",
  properties: {
    label: { type: "string", description: "Short name, e.g. 'control' or 'hook B: work policy'." },
    ad_id: { type: ["string", "null"], description: "The live ad for this variant, if it exists already." },
    creative_job_id: { type: ["string", "null"], description: "The creative_job_id returned when you started this variant's creative, if it's still being made." },
  },
  required: ["label", "ad_id", "creative_job_id"],
  additionalProperties: false,
};

export const planExperimentTool: ExtraTool = {
  def: tool("plan_experiment", `Record a controlled test before (or right after) launching its variants: what you believe and why, the one lever being changed, the success metric and the minimum sample per variant (at least ${MIN_IMPRESSIONS_PER_VARIANT} impressions). At most ${MAX_CONCURRENT_EXPERIMENTS} experiments run at once.`, {
    hypothesis: { type: "string" },
    rationale: { type: "string", description: "The numbers or precedent behind it." },
    lever: { type: "string", enum: [...LEVERS] },
    success_metric: { type: "string", enum: [...METRICS] },
    variants: { type: "array", items: variantSchema, description: "2 to 4 variants, usually including the current ad as control." },
    min_impressions: { type: "integer" },
    min_thruplays: { type: "integer", description: "0 unless judging on video retention." },
  }),
  spend: () => true,
  step: "hypothesizing",
  async run(input, env) {
    const variants = (Array.isArray(input.variants) ? input.variants : []) as Variant[];
    const lever = String(input.lever);
    const metric = String(input.success_metric);
    const minImpr = Math.round(Number(input.min_impressions));
    const minThru = Math.max(0, Math.round(Number(input.min_thruplays) || 0));
    if (!LEVERS.includes(lever as never) || !METRICS.includes(metric as never)) return { content: "Unknown lever or metric.", isError: true };
    if (variants.length < 2 || variants.length > 4) return { content: "Use 2 to 4 variants.", isError: true };
    if (variants.some((v) => !v.label || (!v.ad_id && !v.creative_job_id))) return { content: "Each variant needs a label and either a live ad_id or the creative_job_id that will produce it.", isError: true };
    if (!Number.isFinite(minImpr) || minImpr < MIN_IMPRESSIONS_PER_VARIANT) return { content: `The minimum sample must be at least ${MIN_IMPRESSIONS_PER_VARIANT} impressions per variant.`, isError: true };
    const ids = variants.map((v) => v.ad_id).filter(Boolean) as string[];
    // Check against the table, not the review-start snapshot: variants may have launched this review
    const { data: found } = ids.length ? await supabaseAdmin.from("ads").select("meta_ad_id").eq("agent_id", env.agent.id).in("meta_ad_id", ids) : { data: [] };
    const known = new Set((found ?? []).map((a) => a.meta_ad_id));
    const unknown = ids.find((id) => !known.has(id));
    if (unknown) return { content: `No ad ${unknown} in this account.`, isError: true };
    const { count } = await supabaseAdmin.from("experiments").select("id", { count: "exact", head: true }).eq("agent_id", env.agent.id).in("status", ["planned", "running"]);
    if ((count ?? 0) >= MAX_CONCURRENT_EXPERIMENTS)
      return { content: `${count} experiments are already open, the most allowed. Let one finish before starting another.`, isError: true };
    const allLive = variants.every((v) => v.ad_id);
    const { data: exp } = await supabaseAdmin
      .from("experiments")
      .insert({
        agent_id: env.agent.id,
        run_id: env.runId,
        hypothesis: String(input.hypothesis).slice(0, 500),
        rationale: String(input.rationale).slice(0, 1000),
        lever,
        success_metric: metric,
        variants: variants.map((v) => ({ label: v.label.slice(0, 60), ad_id: v.ad_id, creative_job_id: v.creative_job_id })),
        min_impressions: minImpr,
        min_thruplays: minThru,
        status: allLive ? "running" : "planned",
        started_at: allLive ? new Date().toISOString() : null,
      })
      .select("id")
      .single();
    await emit({ agentId: env.agent.id, runId: env.runId, step: "hypothesizing", tier: "code", summary: `Planned experiment: ${String(input.hypothesis).slice(0, 140)}`, evidence: { lever, metric, variants: variants.length, min_impressions: minImpr } });
    return { content: `Planned experiment ${exp?.id}. It will be judged once every variant has ${minImpr} impressions${minThru ? ` and ${minThru} ThruPlays` : ""}.` };
  },
};

export const concludeExperimentTool: ExtraTool = {
  def: tool("conclude_experiment", "Close an experiment once every variant has its minimum sample (the system refuses earlier). The numbers are recorded from the account, not from you.", {
    experiment_id: { type: "string" },
    verdict: { type: "string", enum: ["winner", "no_difference", "inconclusive"] },
    winner_label: { type: ["string", "null"] },
    summary: { type: "string", description: "One or two sentences on what the test showed." },
  }),
  spend: () => true,
  step: "remembering",
  async run(input, env) {
    const { data: exp } = await supabaseAdmin.from("experiments").select("*").eq("id", String(input.experiment_id)).eq("agent_id", env.agent.id).maybeSingle();
    if (!exp) return { content: "No such experiment for this agent.", isError: true };
    if (exp.status !== "running") return { content: `That experiment is ${exp.status}, not running.`, isError: true };
    const p = progress(exp as Experiment, env.snapshot.adMetrics);
    if (!allReady(p)) {
      const short = p.filter((v) => !v.ready).map((v) => `${v.label}: ${v.impressions}/${exp.min_impressions} impressions${exp.min_thruplays ? `, ${v.thruplays}/${exp.min_thruplays} ThruPlays` : ""}`);
      return { content: `Too early to end this experiment (never end one early). Still short: ${short.join("; ")}.`, isError: true };
    }
    const verdict = String(input.verdict);
    const winner = typeof input.winner_label === "string" ? input.winner_label : null;
    if (verdict === "winner" && !p.some((v) => v.label === winner)) return { content: "winner_label must match one of the variant labels.", isError: true };
    const result = { summary: String(input.summary).slice(0, 600), variants: p.map((v) => ({ label: v.label, ad_id: v.ad_id, results: v.metrics ? present(v.metrics) : null })) };
    await supabaseAdmin.from("experiments").update({ status: "concluded", verdict, winner_label: verdict === "winner" ? winner : null, result, concluded_at: new Date().toISOString() }).eq("id", exp.id);
    await emit({ agentId: env.agent.id, runId: env.runId, step: "remembering", tier: "code", summary: `Concluded: ${exp.hypothesis.slice(0, 100)} → ${verdict}${winner ? ` (${winner})` : ""}`, evidence: result });
    return { content: `Concluded. Record what it taught with record_learning.` };
  },
};

export const recordLearningTool: ExtraTool = {
  def: tool("record_learning", "Save something this account has learned (from an experiment, the market, or a clear pattern in results) so future reviews build on it.", {
    insight: { type: "string", description: "One sentence, specific: 'Question hooks about work coverage beat family-protection hooks on hook rate (31% vs 22%).'" },
    confidence: { type: "string", enum: ["low", "medium", "high"] },
    source: { type: "string", enum: ["experiment", "market", "review"] },
    experiment_id: { type: ["string", "null"] },
  }),
  spend: () => false,
  step: "remembering",
  async run(input, env) {
    const insight = String(input.insight ?? "").slice(0, 400);
    if (!insight) return { content: "The insight is required.", isError: true };
    const expId = typeof input.experiment_id === "string" ? input.experiment_id : null;
    let evidence: Record<string, unknown> = {};
    if (expId) {
      const { data: exp } = await supabaseAdmin.from("experiments").select("result, status").eq("id", expId).eq("agent_id", env.agent.id).maybeSingle();
      if (!exp) return { content: "No such experiment for this agent.", isError: true };
      evidence = { experiment: exp.result };
    }
    await supabaseAdmin.from("learnings").insert({
      agent_id: env.agent.id,
      insight,
      confidence: ["low", "medium", "high"].includes(String(input.confidence)) ? input.confidence : "low",
      source: ["experiment", "market", "review"].includes(String(input.source)) ? input.source : "review",
      experiment_id: expId,
      evidence,
    });
    await emit({ agentId: env.agent.id, runId: env.runId, step: "remembering", tier: "code", summary: `Learned: ${insight.slice(0, 160)}`, evidence: { confidence: input.confidence, experiment_id: expId } });
    return { content: "Saved to the learnings library." };
  },
};

export const EXPERIMENT_TOOLS = [planExperimentTool, concludeExperimentTool, recordLearningTool];

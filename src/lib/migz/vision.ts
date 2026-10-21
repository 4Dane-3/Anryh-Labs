import "server-only";
import { execFile } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type Anthropic from "@anthropic-ai/sdk";
import type { BetaContentBlockParam } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { supabaseAdmin } from "@/lib/supabase-admin";
import type { Agent } from "@/lib/booking/data";
import { begin } from "@/lib/migz/events";
import { present } from "@/lib/migz/metrics";
import type { ExtraTool, OperatorEnv } from "@/lib/migz/operator";
import { callModel, jsonOf, planTier, type Budget, type CreateMessage } from "@/lib/migz/router";
import type { Snapshot } from "@/lib/migz/snapshot";
import { TRAITS_SCHEMA, type Traits } from "@/lib/migz/team/scout";

// The vision tier: frames from each video (0s, 1s, 2s, 3s, then every 3s; the image itself for stills)
// go to Sonnet, which returns structured creative traits stored on the creative. diagnose_creative
// pairs those traits with the ad's numbers and a code-computed read of the diagnosis ladder.

const run = promisify(execFile);
export const MAX_FRAMES = 10;
export const TRAITS_PER_RUN = 2;

/** Seconds to sample: 0, 1, 2, 3, then every 3s up to the clip length (capped at MAX_FRAMES). */
export function frameTimes(durationS: number) {
  const out = [0, 1, 2, 3].filter((t) => t < Math.max(durationS, 0.5));
  for (let t = 6; t < durationS && out.length < MAX_FRAMES; t += 3) out.push(t);
  return out.slice(0, MAX_FRAMES);
}

async function ffmpegPath() {
  try {
    const mod = (await import("ffmpeg-static")) as unknown as { default?: string | null } | string;
    return (typeof mod === "string" ? mod : mod.default) ?? null;
  } catch {
    return null;
  }
}

/** JPEG frames from a video file, or null when ffmpeg isn't available here. */
export async function extractFrames(video: Buffer, durationS = 15): Promise<{ t: number; jpeg: Buffer }[] | null> {
  const bin = await ffmpegPath();
  if (!bin) return null;
  const dir = await mkdtemp(join(tmpdir(), "migz-frames-"));
  try {
    const src = join(dir, "in.mp4");
    await writeFile(src, video);
    const times = frameTimes(durationS);
    const frames: { t: number; jpeg: Buffer }[] = [];
    for (const t of times) {
      const out = join(dir, `f${t}.jpg`);
      try {
        await run(bin, ["-loglevel", "error", "-ss", String(t), "-i", src, "-frames:v", "1", "-vf", "scale=512:-2", "-q:v", "5", "-y", out], { timeout: 20_000 });
      } catch {
        continue; // past the end of the clip
      }
      if ((await readdir(dir)).includes(`f${t}.jpg`)) frames.push({ t, jpeg: await readFile(out) });
    }
    return frames.length ? frames : null;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const VISION_SYSTEM = `You are the creative analyst on Migz AI's ad team for an independent life insurance agent's Meta ads. You get frames from one ad (with their timestamps) or the single image of a still ad, plus its copy. Describe it as structured traits: the angle, the hook type and what the opening image shows in the first 3 seconds, the emotional tone, the setting, how legible any on-screen text is on a phone, the claims it makes, and its compliance risk under Meta's financial-products rules (no guarantees, no implied approval, no calling out personal attributes). Describe only what you can see and read.`;

type CreativeRow = { id: string; kind: string; storage_path: string; mime_type: string | null; hook: string | null; script: unknown };

/** Computes and stores traits for one creative. Returns null when there's nothing to look at or no budget. */
export async function traitCreative(creative: CreativeRow, opts: { agentId: string; runId: string | null; budget: Budget; createMessage: CreateMessage; copy?: string | null }) {
  const plan = planTier("creative_traits", opts.budget);
  if (!plan) return null;
  const done = await begin({ agentId: opts.agentId, runId: opts.runId, step: "watching", tier: plan.tier, summary: `Watching a ${creative.kind} creative` });
  const { data: file } = await supabaseAdmin.storage.from("creatives").download(creative.storage_path);
  if (!file) {
    await done({ summary: "Couldn't open the creative file" });
    return null;
  }
  const bytes = Buffer.from(await file.arrayBuffer());

  const content: BetaContentBlockParam[] = [];
  let frameCount = 0;
  if (creative.kind === "image") {
    const media = (creative.mime_type ?? "image/png") as "image/png" | "image/jpeg" | "image/webp" | "image/gif";
    content.push({ type: "image", source: { type: "base64", media_type: media, data: bytes.toString("base64") } });
    frameCount = 1;
  } else {
    const frames = await extractFrames(bytes);
    if (!frames) {
      await done({ summary: "Couldn't pull frames from this video" });
      return null;
    }
    for (const f of frames) {
      content.push({ type: "text", text: `Frame at ${f.t}s:` });
      content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: f.jpeg.toString("base64") } });
    }
    frameCount = frames.length;
  }
  const script = creative.script as { hook_line?: string; primary_text?: string; headline?: string; overlay_lines?: string[] } | null;
  content.push({
    type: "text",
    text: `Ad copy: ${JSON.stringify({ hook: creative.hook, primary_text: script?.primary_text ?? opts.copy ?? null, headline: script?.headline ?? null, on_image_text: script?.overlay_lines ?? null })}`,
  });

  const res = await callModel({
    task: "creative_traits",
    tier: plan.tier,
    degraded: plan.degraded,
    agentId: opts.agentId,
    runId: opts.runId,
    createMessage: opts.createMessage,
    params: {
      max_tokens: 2000,
      output_config: { effort: "low", format: { type: "json_schema", schema: TRAITS_SCHEMA } },
      system: [{ type: "text", text: VISION_SYSTEM, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content }],
    },
  });
  const traits = jsonOf<Traits>(res.message);
  if (traits) await supabaseAdmin.from("creatives").update({ traits, traits_at: new Date().toISOString() }).eq("id", creative.id);
  await done({
    summary: traits ? `${creative.kind === "image" ? "Image" : `Video (${frameCount} frames)`}: ${traits.angle}, ${traits.hook_type} hook, ${traits.compliance_risk} compliance risk` : "Couldn't read this creative",
    evidence: traits ? { traits, frames: frameCount } : { frames: frameCount },
    inputTokens: res.usage.input,
    outputTokens: res.usage.output,
    model: res.model,
  });
  return traits;
}

/** Before a review: trait up to TRAITS_PER_RUN live creatives that haven't been looked at yet. */
export async function watchNewCreatives(agent: Agent, opts: { runId: string; budget: Budget; createMessage: CreateMessage }) {
  const { data } = await supabaseAdmin
    .from("ads")
    .select("primary_text, creatives(id, kind, storage_path, mime_type, hook, script, traits)")
    .eq("agent_id", agent.id)
    .eq("status", "ACTIVE")
    .not("creative_id", "is", null);
  const todo = (data ?? [])
    .map((r) => ({ creative: r.creatives as unknown as (CreativeRow & { traits: unknown }) | null, copy: r.primary_text as string | null }))
    .filter((r): r is { creative: CreativeRow & { traits: unknown }; copy: string | null } => !!r.creative && !r.creative.traits && !!r.creative.storage_path);
  const seen = new Set<string>();
  let n = 0;
  for (const { creative, copy } of todo) {
    if (seen.has(creative.id) || n >= TRAITS_PER_RUN) continue;
    seen.add(creative.id);
    n++;
    await traitCreative(creative, { agentId: agent.id, ...opts, copy });
  }
  return n;
}

type Rates = { hook_rate: number | null; hold_rate: number | null; link_ctr: number | null; visit_to_booking: number | null; frequency: number | null };

/**
 * The diagnosis ladder in code, against the ad set's own averages (no outside benchmarks).
 * "Low" means under 75% of the ad set average; enough data is required for each rung.
 */
export function ladder(ad: Rates & { impressions: number; visits: number }, avg: Rates, fatigueSignals: string[]) {
  const low = (v: number | null, a: number | null) => v !== null && a !== null && a > 0 && v < a * 0.75;
  const ok = (v: number | null, a: number | null) => v !== null && a !== null && v >= a * 0.75;
  if (ad.impressions < 1000) return { rung: "too_early", read: "Fewer than 1,000 impressions: too early to diagnose." };
  if (fatigueSignals.length) return { rung: "fatigue", read: `Fatigue: ${fatigueSignals.join("; ")}. Refresh the creative.` };
  if (low(ad.hook_rate, avg.hook_rate)) return { rung: "hook", read: "Hook rate is well below the ad set average: fix the first 3 seconds." };
  if (ok(ad.hook_rate, avg.hook_rate) && low(ad.hold_rate, avg.hold_rate)) return { rung: "body", read: "The hook works but viewers drop off: fix the body, keep the hook." };
  if (low(ad.link_ctr, avg.link_ctr)) return { rung: "copy", read: "People watch but don't click: test the offer, call to action or copy." };
  if (ad.visits >= 20 && low(ad.visit_to_booking, avg.visit_to_booking))
    return { rung: "landing", read: "Clicks arrive but don't book: a landing page or audience mismatch, not a creative problem." };
  return { rung: "healthy", read: "At or above the ad set average on each step." };
}

export const diagnoseCreativeTool: ExtraTool = {
  def: {
    name: "diagnose_creative",
    description: "Read-only. For one ad: its creative traits (what's in the frames), its funnel numbers vs its ad set's average (hook rate, hold rate, retention, link click-through, visit-to-booking, frequency), and which rung of the diagnosis ladder it's on.",
    strict: false, // see MAX_STRICT_TOOLS in tools.ts
    input_schema: { type: "object", properties: { ad_id: { type: "string" } }, required: ["ad_id"], additionalProperties: false },
  } satisfies Anthropic.Beta.BetaTool,
  spend: () => false,
  step: "watching",
  async run(input, env: OperatorEnv) {
    const adId = String(input.ad_id ?? "");
    const { data: ad } = await supabaseAdmin
      .from("ads")
      .select("meta_ad_id, adset_id, primary_text, creatives(id, kind, storage_path, mime_type, hook, script, traits)")
      .eq("agent_id", env.agent.id)
      .eq("meta_ad_id", adId)
      .maybeSingle();
    if (!ad) return { content: `No ad ${adId} in this account.`, isError: true };
    const creative = ad.creatives as unknown as (CreativeRow & { traits: Traits | null }) | null;
    let traits = creative?.traits ?? null;
    if (creative && !traits && creative.storage_path)
      traits = await traitCreative(creative, { agentId: env.agent.id, runId: env.runId, budget: env.budget, createMessage: env.createMessage, copy: ad.primary_text });

    const m = env.snapshot.adMetrics.get(adId);
    const siblings = [...env.snapshot.adMetrics.entries()].filter(([id]) =>
      env.snapshot.guardAdsets.some((s) => s.ads.some((a) => a.meta_ad_id === id) && s.ads.some((a) => a.meta_ad_id === adId)),
    );
    const avg = averageRates(siblings.map(([, v]) => v.d14));
    const d = m?.d14;
    const verdict = d
      ? ladder({ hook_rate: d.hook_rate, hold_rate: d.hold_rate, link_ctr: d.link_ctr, visit_to_booking: d.visit_to_booking, frequency: d.frequency, impressions: d.impressions, visits: d.visits }, avg, m.fatigue.signals)
      : { rung: "too_early", read: "No results yet." };
    return {
      content: JSON.stringify({
        ad_id: adId,
        traits: traits ?? "not analyzed",
        last_14_days: d ? present(d) : "no data",
        ad_set_average: avg,
        diagnosis: verdict,
      }),
    };
  },
};

function averageRates(list: { hook_rate: number | null; hold_rate: number | null; link_ctr: number | null; visit_to_booking: number | null; frequency: number | null }[]): Rates {
  const mean = (k: keyof Rates) => {
    const vals = list.map((x) => x[k]).filter((v): v is number => v !== null);
    return vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null;
  };
  return { hook_rate: mean("hook_rate"), hold_rate: mean("hold_rate"), link_ctr: mean("link_ctr"), visit_to_booking: mean("visit_to_booking"), frequency: mean("frequency") };
}

export type { Snapshot };

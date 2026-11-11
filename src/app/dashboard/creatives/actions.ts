"use server";

import { revalidatePath } from "next/cache";
import { requireAgent } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { checkCopyFor } from "@/lib/migz/guardrails";
import { cloneVoice, startPresenterVideo, writeScript } from "@/lib/migz/presenter";
import { normalizeUsPhone } from "@/lib/migz/sms";
import { scanBrandSite, type ScanResult } from "@/lib/edit/brand-scan";
import { normalizeHex } from "@/lib/edit/brand";

/** Whether Migz's videos wait for the agent's OK before going to Meta. Videos already waiting keep waiting. */
export async function setVideoApproval(on: boolean): Promise<{ ok: boolean; error?: string }> {
  const agent = await requireAgent();
  const { error } = await supabaseAdmin.from("agents").update({ video_approval: on }).eq("id", agent.id);
  if (error) return { ok: false, error: "Couldn't save that. Try again." };
  revalidatePath("/dashboard/creatives");
  return { ok: true };
}

export async function saveTextSettings(phone: string, on: boolean): Promise<{ ok: boolean; error?: string }> {
  const agent = await requireAgent();
  const number = phone.trim() ? normalizeUsPhone(phone) : null;
  if (phone.trim() && !number) return { ok: false, error: "Enter a 10-digit US mobile number." };
  if (on && !number) return { ok: false, error: "Add your mobile number first." };
  const { error } = await supabaseAdmin.from("agents").update({ sms_phone: number, sms_opt_in_at: on ? (agent.sms_opt_in_at ?? new Date().toISOString()) : null }).eq("id", agent.id);
  if (error) return { ok: false, error: "Couldn't save that. Try again." };
  revalidatePath("/dashboard/creatives");
  return { ok: true };
}

type PresenterInput = {
  mode: "film" | "ai" | "none";
  towns: string;
  consentName: string;
  consented: boolean;
  onCameraName: string;
  onCameraRole: string;
  onCameraVoice: "male" | "female";
};

export async function savePresenter(input: PresenterInput): Promise<{ ok: boolean; error?: string }> {
  const agent = await requireAgent();
  if (!["film", "ai", "none"].includes(input.mode)) return { ok: false, error: "Pick how you want to appear." };
  if (input.mode === "ai" && (!input.consented || input.consentName.trim().length < 2)) return { ok: false, error: "Type your name and tick the box to use AI with your likeness." };
  if (input.mode !== "none" && input.onCameraName.trim().length < 2) return { ok: false, error: "Add the first name of who's on camera." };
  const problem = checkCopyFor("roofing", input.onCameraRole);
  if (problem) return { ok: false, error: problem };
  const { data: prior } = await supabaseAdmin.from("agent_presenters").select("consent_at, consent_name").eq("agent_id", agent.id).maybeSingle();
  const { error } = await supabaseAdmin.from("agent_presenters").upsert({
    agent_id: agent.id,
    mode: input.mode,
    towns: input.towns.split(",").map((t) => t.trim()).filter(Boolean).slice(0, 3),
    on_camera_name: input.onCameraName.trim().slice(0, 40) || null,
    on_camera_role: input.onCameraRole.trim().slice(0, 40) || null,
    on_camera_voice: input.onCameraVoice === "female" ? "female" : "male",
    consent_name: input.consented ? input.consentName.trim().slice(0, 120) : (prior?.consent_name ?? null),
    consent_at: input.consented ? (prior?.consent_at ?? new Date().toISOString()) : (prior?.consent_at ?? null),
    updated_at: new Date().toISOString(),
  });
  if (error) return { ok: false, error: "Couldn't save that. Try again." };
  revalidatePath("/dashboard/creatives/presenter");
  return { ok: true };
}

/** Records a file the browser just uploaded. A voice sample is cloned right away, with the consent on file. */
export async function addPresenterFile(kind: "photo" | "job" | "film" | "voice", path: string): Promise<{ ok: boolean; error?: string }> {
  const agent = await requireAgent();
  if (!path.startsWith(`${agent.id}/`)) return { ok: false, error: "Invalid upload." };
  const { data: row } = await supabaseAdmin.from("agent_presenters").select("*").eq("agent_id", agent.id).maybeSingle();
  if (!row) return { ok: false, error: "Save your choices first." };
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (kind === "photo") patch.photo_paths = [...row.photo_paths, path].slice(-3);
  if (kind === "job") patch.job_photo_paths = [...row.job_photo_paths, path].slice(-6);
  if (kind === "film") patch.film_path = path;
  if (kind === "voice") {
    if (!row.consent_at) return { ok: false, error: "Give your consent above first." };
    patch.voice_sample_path = path;
    try {
      patch.elevenlabs_voice_id = await cloneVoice(path, agent.full_name);
    } catch (e) {
      console.error("voice clone failed", e);
      return { ok: false, error: "Couldn't use that recording. Try a clear minute of you talking." };
    }
  }
  const { error } = await supabaseAdmin.from("agent_presenters").update(patch).eq("agent_id", agent.id);
  if (error) return { ok: false, error: "Couldn't save that upload." };
  revalidatePath("/dashboard/creatives/presenter");
  return { ok: true };
}

/** Reads their website's fonts and colours for them to check before saving. Nothing is saved here. */
export async function scanWebsite(url: string): Promise<{ ok: boolean; found?: ScanResult; error?: string }> {
  await requireAgent();
  try {
    return { ok: true, found: await scanBrandSite(url) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Couldn't read that website." };
  }
}

export type BrandInput = {
  website: string;
  headingFont: string;
  bodyFont: string;
  background: string;
  text: string;
  accent: string;
  fontNote: string | null;
  deals: string[];
  certifications: string[];
  license: string;
  warranties: string[];
};

const lines = (xs: string[], n: number, len: number) => xs.map((x) => x.trim().slice(0, len)).filter(Boolean).slice(0, n);

/** Their brand and the facts videos may feature. The first deal and certification are what Migz features first. */
export async function saveBrand(input: BrandInput): Promise<{ ok: boolean; error?: string }> {
  const agent = await requireAgent();
  const deals = lines(input.deals, 3, 60);
  const certifications = lines(input.certifications, 4, 60);
  const warranties = lines(input.warranties, 3, 80);
  const license = input.license.trim().slice(0, 40) || null;
  const problem = checkCopyFor("roofing", ...deals, ...certifications, ...warranties, license ?? "");
  if (problem) return { ok: false, error: problem };
  const hex = (c: string) => normalizeHex(c);
  const { error } = await supabaseAdmin.from("agent_brand").upsert({
    agent_id: agent.id,
    website: input.website.trim().slice(0, 200) || null,
    heading_font: input.headingFont.trim().slice(0, 60) || null,
    body_font: input.bodyFont.trim().slice(0, 60) || null,
    background: hex(input.background),
    text_color: hex(input.text),
    accent: hex(input.accent),
    font_note: input.fontNote,
    deals,
    certifications,
    license,
    warranties,
    scanned_at: input.website.trim() ? new Date().toISOString() : null,
    updated_at: new Date().toISOString(),
  });
  if (error) return { ok: false, error: "Couldn't save that. Try again." };
  // The presenter's featured offer and badge follow the first of each (the script and Migz's own ads read them)
  await supabaseAdmin.from("agent_presenters").update({ offer: deals[0] ?? null, badge: certifications[0] ?? null, updated_at: new Date().toISOString() }).eq("agent_id", agent.id);
  revalidatePath("/dashboard/creatives/presenter");
  return { ok: true };
}

export async function addBrandLogo(path: string): Promise<{ ok: boolean; error?: string }> {
  const agent = await requireAgent();
  if (!path.startsWith(`${agent.id}/`)) return { ok: false, error: "Invalid upload." };
  const { error } = await supabaseAdmin.from("agent_brand").upsert({ agent_id: agent.id, logo_path: path, updated_at: new Date().toISOString() });
  if (error) return { ok: false, error: "Couldn't save your logo." };
  revalidatePath("/dashboard/creatives/presenter");
  return { ok: true };
}

export async function getFilmScript(): Promise<{ ok: boolean; script?: string; error?: string }> {
  const agent = await requireAgent();
  try {
    return { ok: true, script: (await writeScript(agent)).script };
  } catch (e) {
    console.error("script failed", e);
    return { ok: false, error: "Couldn't write a script just now. Try again." };
  }
}

export async function makePresenterVideo(): Promise<{ ok: boolean; message?: string; error?: string }> {
  const agent = await requireAgent();
  try {
    await startPresenterVideo(agent);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Couldn't start the video." };
  }
  revalidatePath("/dashboard/creatives");
  return { ok: true, message: "Migz is making your video. You'll get a preview to approve when it's ready." };
}

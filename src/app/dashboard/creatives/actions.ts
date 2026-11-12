"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { ensureJobsiteLook } from "@/lib/migz/presenter-look";
import { requireAgent } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { checkCopyFor } from "@/lib/migz/guardrails";
import { cloneVoice, isPlanBlock, startPresenterVideo, writeScript } from "@/lib/migz/presenter";
import { alertAdmin } from "@/lib/migz/slack";
import { deleteVoice, findVoices, isVoiceId, type AdVoice, type VoiceFilter } from "@/lib/voice/ad-voices";
import { normalizeUsPhone } from "@/lib/migz/sms";
import { scanBrandSite, type ScanResult } from "@/lib/edit/brand-scan";
import { normalizeHex } from "@/lib/edit/brand";
import { allMedia, isMediaKind, MAX_JOB_MEDIA, type JobMedia } from "@/lib/roofing/job-media";

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
  onCameraPronunciation?: string;
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
    // Only sent when given, so saving works before migration 20261212000000
    ...(input.onCameraPronunciation?.trim() ? { on_camera_pronunciation: input.onCameraPronunciation.trim().slice(0, 60) } : {}),
    consent_name: input.consented ? input.consentName.trim().slice(0, 120) : (prior?.consent_name ?? null),
    consent_at: input.consented ? (prior?.consent_at ?? new Date().toISOString()) : (prior?.consent_at ?? null),
    updated_at: new Date().toISOString(),
  });
  if (error) return { ok: false, error: "Couldn't save that. Try again." };
  // Their jobsite look, made in the background once there's a consented photo
  if (input.mode === "ai") after(() => ensureJobsiteLook(agent.id).then(() => undefined).catch((e) => console.error("jobsite look failed", e)));
  revalidatePath("/dashboard/creatives/presenter");
  revalidatePath("/dashboard/start");
  return { ok: true };
}

/** Records a file the browser just uploaded. A voice sample is cloned right away, with the consent on file. */
export async function addPresenterFile(kind: "photo" | "job" | "film" | "voice", path: string): Promise<{ ok: boolean; error?: string; message?: string }> {
  const agent = await requireAgent();
  if (!path.startsWith(`${agent.id}/`)) return { ok: false, error: "Invalid upload." };
  const { data: row } = await supabaseAdmin.from("agent_presenters").select("*").eq("agent_id", agent.id).maybeSingle();
  if (!row) return { ok: false, error: kind === "voice" ? "Give your consent above first." : "Save your choices first." };
  let message: string | undefined;
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (kind === "photo") {
    patch.photo_paths = [...row.photo_paths, path].slice(-3);
    // A new photo makes a new jobsite look, in the background
    after(() => ensureJobsiteLook(agent.id).then(() => undefined).catch((e) => console.error("jobsite look failed", e)));
  }
  if (kind === "job") patch.job_photo_paths = [...row.job_photo_paths, path].slice(-6);
  if (kind === "film") patch.film_path = path;
  if (kind === "voice") {
    if (!row.consent_at) return { ok: false, error: "Give your consent above first." };
    // The recording is kept either way (a new one replaces the old voice); the voice is made from it now, or
    // later when cloning is switched on for our ElevenLabs account
    patch.voice_sample_path = path;
    patch.elevenlabs_voice_id = null;
    try {
      patch.elevenlabs_voice_id = await cloneVoice(path, agent.full_name);
      // The voice from their last recording: deleted, so a re-record never uses up another slot
      if (row.elevenlabs_voice_id) await deleteVoice(row.elevenlabs_voice_id);
      // A new recording is the voice they want: their ads use it
      patch.ad_voice_id = "own";
      patch.ad_voice_name = "Your voice";
      message = "Your voice is ready. Your next videos use it.";
    } catch (e) {
      console.error("voice clone failed", e);
      if (!isPlanBlock(e)) return { ok: false, error: "Couldn't make a voice from that recording. Try again in a quiet room, a minute or more of you talking." };
      message = "Recording saved. Your voice will be made from it as soon as voice copying is switched on for your account; you don't need to record again.";
      await alertAdmin(`*Voice cloning is off on the ElevenLabs plan*: ${agent.full_name} recorded their voice; it's saved and will be cloned once the plan includes instant voice cloning.`).catch(() => {});
    }
  }
  let { error } = await supabaseAdmin.from("agent_presenters").update(patch).eq("agent_id", agent.id);
  // Before migration 20261213 there's no voice choice to set: keep the voice itself
  if (error && (error.code === "42703" || error.code === "PGRST204") && "ad_voice_id" in patch) {
    delete patch.ad_voice_id;
    delete patch.ad_voice_name;
    ({ error } = await supabaseAdmin.from("agent_presenters").update(patch).eq("agent_id", agent.id));
  }
  if (error) return { ok: false, error: "Couldn't save that upload." };
  revalidatePath("/dashboard/creatives/presenter");
  revalidatePath("/dashboard/start");
  return { ok: true, message };
}

/** Consent to their voice (and photo) being used for their ads, from the voice recorder. */
export async function saveVoiceConsent(name: string): Promise<{ ok: boolean; error?: string }> {
  const agent = await requireAgent();
  const who = name.trim().slice(0, 120);
  if (who.length < 2) return { ok: false, error: "Type your full name to agree." };
  const { data: prior } = await supabaseAdmin.from("agent_presenters").select("consent_at").eq("agent_id", agent.id).maybeSingle();
  const { error } = await supabaseAdmin
    .from("agent_presenters")
    .upsert({ agent_id: agent.id, consent_name: who, consent_at: prior?.consent_at ?? new Date().toISOString(), updated_at: new Date().toISOString() }, { onConflict: "agent_id" });
  if (error) return { ok: false, error: "Couldn't save that. Try again." };
  return { ok: true };
}

/** Voices to pick from for their ads (ElevenLabs' own, then the Voice Library). */
export async function listAdVoices(filter: VoiceFilter): Promise<{ ok: boolean; voices?: AdVoice[]; more?: boolean; error?: string }> {
  await requireAgent();
  try {
    return { ok: true, ...(await findVoices(filter)) };
  } catch (e) {
    console.error("listing voices failed", e);
    return { ok: false, error: "Couldn't load the voices. Try again." };
  }
}

/** The voice their ads are spoken in: an ElevenLabs voice, or "own" for their cloned voice. */
export async function chooseAdVoice(id: string, name: string): Promise<{ ok: boolean; error?: string }> {
  const agent = await requireAgent();
  if (id !== "own" && !isVoiceId(id)) return { ok: false, error: "Pick a voice from the list." };
  if (id === "own") {
    const { data } = await supabaseAdmin.from("agent_presenters").select("elevenlabs_voice_id, voice_sample_path").eq("agent_id", agent.id).maybeSingle();
    if (!data?.elevenlabs_voice_id && !data?.voice_sample_path) return { ok: false, error: "Record your voice first." };
  }
  const { error } = await supabaseAdmin
    .from("agent_presenters")
    .upsert({ agent_id: agent.id, ad_voice_id: id, ad_voice_name: id === "own" ? "Your voice" : name.trim().slice(0, 60) || null, updated_at: new Date().toISOString() }, { onConflict: "agent_id" });
  if (error) return { ok: false, error: error.code === "42703" || error.code === "PGRST204" ? MEDIA_MIGRATION : "Couldn't save that. Try again." };
  revalidatePath("/dashboard/creatives/presenter");
  revalidatePath("/dashboard/start");
  return { ok: true };
}

const MEDIA_MIGRATION = "Run migration 20261213000000_presenter_job_media.sql first.";

/** Adds a job photo or clip the browser just uploaded, with what it shows. Works before anything else is saved. */
export async function addJobMedia(kind: string, path: string, type: "photo" | "video"): Promise<{ ok: boolean; media?: JobMedia[]; error?: string }> {
  const agent = await requireAgent();
  if (!path.startsWith(`${agent.id}/`) || !isMediaKind(kind) || (type !== "photo" && type !== "video")) return { ok: false, error: "Invalid upload." };
  const { data: row, error: readErr } = await supabaseAdmin.from("agent_presenters").select("job_media").eq("agent_id", agent.id).maybeSingle();
  if (readErr) return { ok: false, error: readErr.code === "42703" ? MEDIA_MIGRATION : "Couldn't save that upload." };
  const media = [...((row?.job_media as JobMedia[] | null) ?? []), { path, kind, type }].slice(-MAX_JOB_MEDIA);
  const { error } = await supabaseAdmin.from("agent_presenters").upsert({ agent_id: agent.id, job_media: media, updated_at: new Date().toISOString() }, { onConflict: "agent_id" });
  if (error) return { ok: false, error: error.code === "42703" || error.code === "PGRST204" ? MEDIA_MIGRATION : "Couldn't save that upload." };
  revalidatePath("/dashboard/creatives/presenter");
  revalidatePath("/dashboard/start");
  return { ok: true, media };
}

/** Takes a photo or clip out of their videos (the file stays in storage, ads already made keep it). */
export async function removeJobMedia(path: string): Promise<{ ok: boolean; media?: JobMedia[]; error?: string }> {
  const agent = await requireAgent();
  const { data: row } = await supabaseAdmin.from("agent_presenters").select("job_media, job_photo_paths").eq("agent_id", agent.id).maybeSingle();
  if (!row) return { ok: false, error: "Nothing to remove." };
  const media = ((row.job_media as JobMedia[] | null) ?? []).filter((m) => m.path !== path);
  const photos = ((row.job_photo_paths as string[] | null) ?? []).filter((p) => p !== path);
  const { error } = await supabaseAdmin.from("agent_presenters").update({ job_media: media, job_photo_paths: photos, updated_at: new Date().toISOString() }).eq("agent_id", agent.id);
  if (error) return { ok: false, error: "Couldn't remove it." };
  revalidatePath("/dashboard/creatives/presenter");
  revalidatePath("/dashboard/start");
  return { ok: true, media: allMedia(media, photos) };
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
  // A new featured special counts as confirmed today, so the weekly check starts over from it
  const { data: before } = await supabaseAdmin.from("agent_brand").select("deals").eq("agent_id", agent.id).maybeSingle();
  const newSpecial = (before?.deals?.[0] ?? null) !== (deals[0] ?? null);
  const { error } = await supabaseAdmin.from("agent_brand").upsert({
    ...(newSpecial ? { special_confirmed_at: deals[0] ? new Date().toISOString() : null, special_asked_at: null } : {}),
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
  revalidatePath("/dashboard/start");
  return { ok: true };
}

export async function addBrandLogo(path: string): Promise<{ ok: boolean; error?: string }> {
  const agent = await requireAgent();
  if (!path.startsWith(`${agent.id}/`)) return { ok: false, error: "Invalid upload." };
  const { error } = await supabaseAdmin.from("agent_brand").upsert({ agent_id: agent.id, logo_path: path, updated_at: new Date().toISOString() });
  if (error) return { ok: false, error: "Couldn't save your logo." };
  revalidatePath("/dashboard/creatives/presenter");
  revalidatePath("/dashboard/start");
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

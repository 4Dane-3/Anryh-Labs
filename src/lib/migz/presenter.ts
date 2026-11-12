import "server-only";
import { leadOffer } from "@/lib/roofing/setup-options";
import { quoteVariant } from "@/lib/migz/prompt";
import { supabaseAdmin } from "@/lib/supabase-admin";
import type { Agent } from "@/lib/booking/data";
import { callModel, defaultCreateMessage } from "@/lib/migz/router";
import { checkCopyFor } from "@/lib/migz/guardrails";
import { enqueueGeneration } from "@/lib/migz/creative-jobs";
import { parseJson, textOf } from "@/lib/migz/video-revise-merge";
import { isRoofer, verticalOf } from "@/lib/verticals";
import type { CreativeBrief } from "@/lib/migz/brief";
import { ROOFING_HOOK_RULES } from "@/lib/roofing/hooks";
import { heygenReady } from "@/lib/heygen";
import { getBrandRow } from "@/lib/edit/brand-scan";
import { allMedia, pickBroll, type JobMedia } from "@/lib/roofing/job-media";

// The "owner on camera" video: the roofer's choices, the script, and starting a job.

export type Presenter = {
  agent_id: string;
  mode: "film" | "ai" | "none";
  photo_paths: string[];
  job_photo_paths: string[];
  job_media?: JobMedia[]; // their photos and clips by what they show (missing before 20261213000000)
  film_path: string | null;
  voice_sample_path: string | null;
  elevenlabs_voice_id: string | null;
  offer: string | null;
  badge: string | null;
  towns: string[];
  consent_name: string | null;
  consent_at: string | null;
  on_camera_name?: string | null; // who appears (missing before 20261210000000)
  on_camera_role?: string | null;
  on_camera_voice?: "male" | "female" | null;
  on_camera_pronunciation?: string | null; // how to say their name, for the voice ("Eye-ZAY-un"); missing before 20261212000000
  heygen_avatar_id?: string | null; // their photo as a HeyGen photo avatar
  heygen_group_id?: string | null;
  heygen_look_id?: string | null; // them at a jobsite, made from that avatar: what every presenter video is made from
  look_status?: "processing" | "completed" | "failed" | null;
  look_preview_url?: string | null;
  look_photo_path?: string | null;
  ad_voice_id?: string | null; // the voice they picked for their ads: an ElevenLabs voice id, or "own" (missing before 20261213000000)
  ad_voice_name?: string | null;
};

/** The voice their ads are spoken in: the one they picked, their own clone when they picked it (or picked nothing
 * and have one), else null (the default narrator). */
export function adVoiceOf(p: Pick<Presenter, "ad_voice_id" | "elevenlabs_voice_id"> | null | undefined): string | null {
  if (!p) return null;
  if (p.ad_voice_id && p.ad_voice_id !== "own") return p.ad_voice_id;
  return p.elevenlabs_voice_id ?? null;
}

/** The voice an account's ads are spoken in (null: the default narrator). */
export async function adVoiceFor(agentId: string) {
  return adVoiceOf(await getPresenter(agentId).catch(() => null));
}

/** "Gil, owner" for the script, or null when they haven't said who appears. */
export function onCameraLine(p: Pick<Presenter, "on_camera_name" | "on_camera_role"> | null) {
  const name = p?.on_camera_name?.trim();
  if (!name) return null;
  const role = p?.on_camera_role?.trim();
  return role ? `${name}, ${role}` : name;
}

export async function getPresenter(agentId: string) {
  const { data } = await supabaseAdmin.from("agent_presenters").select("*").eq("agent_id", agentId).maybeSingle();
  return data as Presenter | null;
}

/** An instant clone of the roofer's own voice from their sample. Returns the voice id. */
export async function cloneVoice(path: string, name: string) {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) throw new Error("ELEVENLABS_API_KEY is not set");
  const { data, error } = await supabaseAdmin.storage.from("creatives").download(path);
  if (error || !data) throw new Error("Couldn't read the recording");
  const form = new FormData();
  form.append("name", `Presenter: ${name}`.slice(0, 80));
  // Its real extension (a browser recording is WebM or MP4), and phone-room noise taken out before cloning
  form.append("files", data, `sample.${path.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") || "mp3"}`);
  form.append("remove_background_noise", "true");
  const res = await fetch("https://api.elevenlabs.io/v1/voices/add", { method: "POST", headers: { "xi-api-key": key }, body: form });
  if (!res.ok) throw new Error(`ElevenLabs clone ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return ((await res.json()) as { voice_id: string }).voice_id;
}

/** Voice cloning isn't on our ElevenLabs plan (the recording is fine; it waits until it is). */
export const isPlanBlock = (e: unknown) => /paid_plan_required|can_not_use_instant_voice_clon|payment_required/.test(e instanceof Error ? e.message : String(e));

/** Clones their saved recording when there's no voice from it yet (a recording saved while cloning was off). Never throws. */
export async function ensureVoice(agentId: string): Promise<string | null> {
  const p = await getPresenter(agentId);
  if (!p?.voice_sample_path || !p.consent_at) return p?.elevenlabs_voice_id ?? null;
  if (p.elevenlabs_voice_id) return p.elevenlabs_voice_id;
  try {
    const { data: agent } = await supabaseAdmin.from("agents").select("full_name").eq("id", agentId).single();
    const id = await cloneVoice(p.voice_sample_path, (agent?.full_name as string) ?? "Presenter");
    await supabaseAdmin.from("agent_presenters").update({ elevenlabs_voice_id: id, updated_at: new Date().toISOString() }).eq("agent_id", agentId);
    return id;
  } catch (e) {
    console.error("voice clone retry failed", e instanceof Error ? e.message : e);
    return null;
  }
}

type Written = { concept: string; hook_line: string; callout: string; script: string; primary_text: string; headline: string };

/** A 25-second (or 15-second) script in the owner's voice, with the ad's text. Uses only the deals and credentials they gave. */
export async function writeScript(agent: Agent, opts: { seconds?: 15 | 25 } = {}): Promise<Written> {
  const seconds = opts.seconds ?? 25;
  const words = seconds === 15 ? 35 : 60;
  const [p, b] = await Promise.all([getPresenter(agent.id), getBrandRow(agent.id).catch(() => null)]);
  const towns = p?.towns.length ? p.towns.join(", ") : (agent.service_area ?? "the area");
  const list = (xs: (string | null | undefined)[]) => xs.filter(Boolean).join("; ") || "none";
  const facts = [
    `Their current special (say it once, word for word, before "Tap Learn More"): ${(b?.deals.length ? b.deals : [p?.offer]).filter(Boolean)[0] ?? "none: don't mention a discount"}`,
    `Certifications they gave (say at most one, word for word): ${list(b?.certifications.length ? b.certifications : [p?.badge])}`,
    `License: ${b?.license ? `yes (${b.license}); you may say "licensed and insured" only if they gave a license` : "none given"}`,
    `Warranties they gave (word for word if used): ${list(b?.warranties ?? [])}`,
  ].join("\n");
  const { message } = await callModel({
    task: "copy_check",
    tier: "sonnet",
    agentId: agent.id,
    runId: null,
    createMessage: defaultCreateMessage,
    params: {
      max_tokens: 4000, // room for thinking before the JSON
      system: `You write short direct-to-camera Facebook and Instagram Reels ads for local roofing company owners. The owner speaks plainly to neighbors. About ${words} words, ${seconds} seconds: the hook in the first sentence, one honest reason to get the roof looked at, who they are (with their certification, if they gave one), and end with "Tap Learn More" for a ${leadOffer(agent).short}. ${agent.lead_goal === "quote" ? quoteVariant(ROOFING_HOOK_RULES) : ROOFING_HOOK_RULES} Write it to be SPOKEN, the way a roofer actually talks to a neighbor, not ad copy read aloud: contractions, sentence lengths that vary (a 3-word sentence next to a longer one), at most one natural aside like "honestly," or "look,", and punctuation where they'd breathe (commas, a dash for a beat, a question if it fits). Never three sentences in a row with the same shape or length. Only the ${agent.lead_goal === "quote" ? "quote" : "inspection"} is free. Never promise a free roof, never mention paying or waiving an insurance deductible, never mention financing, and never state a price, discount, credential, review count or claim that isn't in the facts. Reply with only JSON: {"concept": "one line", "callout": "2 or 3 word on-screen callout naming ONE town and who it's for, like Kenmore homeowners", "hook_line": "the first sentence", "script": "...", "primary_text": "2 sentences for the post, opening with the same callout", "headline": "under 40 characters"}.`,
      messages: [
        {
          role: "user",
          content: `Company: ${agent.full_name}\nPerson on camera (speaks in first person; introduce them by first name and role once, after the hook): ${onCameraLine(p) ?? "the owner (no name given: don't make one up, say \"I own\" the company)"}\nTowns: ${towns}\n${facts}`,
        },
      ],
    },
  });
  const r = parseJson(textOf(message.content as { type: string; text?: string }[])) as Partial<Written>;
  if (!r.script || !r.primary_text || !r.headline || !r.hook_line) throw new Error("The script came back incomplete. Try again.");
  const callout = (r.callout ?? "").trim().split(/\s+/).slice(0, 4).join(" ");
  const problem = checkCopyFor(verticalOf(agent), callout, r.hook_line, r.script, r.primary_text, r.headline);
  if (problem) throw new Error(`The script broke an ad rule (${problem}). Try again.`);
  return { concept: r.concept ?? "Owner on camera", hook_line: r.hook_line, callout, script: r.script, primary_text: r.primary_text, headline: r.headline };
}

/** Starts the video, into the first running ad set when there is one. */
export async function startPresenterVideo(agent: Agent, opts: { seconds?: 15 | 25 } = {}) {
  if (!isRoofer(agent)) throw new Error("Presenter videos are for roofing accounts for now.");
  const found = await getPresenter(agent.id);
  if (!found || found.mode === "none") throw new Error("Choose how you want to appear first.");
  let p: Presenter & { mode: "film" | "ai" } = { ...found, mode: found.mode };
  if (p.mode === "ai" && !p.consent_at) throw new Error("Give your consent first.");
  if (p.mode === "ai" && !p.photo_paths.length) throw new Error("Upload a headshot or body shot first.");
  if (p.mode === "ai" && !heygenReady()) throw new Error("The AI version isn't switched on yet. Film it yourself for now, or ask us to turn it on.");
  if (p.mode === "film" && !p.film_path) throw new Error("Upload your recording first.");

  // Their jobsite look, if it just finished (the cron also checks it)
  if (p.mode === "ai" && p.look_status === "processing") {
    const { refreshJobsiteLook } = await import("@/lib/migz/presenter-look");
    const status = await refreshJobsiteLook(agent.id).catch(() => null);
    if (status) p = { ...p, look_status: status as Presenter["look_status"] };
  }
  // Their voice, if their recording was saved before cloning was switched on
  if (p.mode === "ai" && p.voice_sample_path && !p.elevenlabs_voice_id && (!p.ad_voice_id || p.ad_voice_id === "own")) p = { ...p, elevenlabs_voice_id: await ensureVoice(agent.id) };
  const written = await writeScript(agent, opts);
  const { data: set } = await supabaseAdmin.from("ad_sets").select("meta_adset_id").eq("agent_id", agent.id).eq("status", "ACTIVE").limit(1).maybeSingle();
  const brief: CreativeBrief = {
    format: "video",
    concept: written.concept,
    style: "owner on camera",
    hook_line: written.hook_line,
    hook_shot: "presenter",
    body_shots: [],
    primary_text: written.primary_text,
    headline: written.headline,
    presenter: {
      mode: p.mode,
      script: written.script,
      callout: written.callout || null,
      towns: p.towns,
      offer: p.offer,
      badge: p.badge,
      photo_paths: p.photo_paths,
      job_paths: p.job_photo_paths,
      broll_media: pickBroll(allMedia(p.job_media, p.job_photo_paths), Math.floor(Math.random() * 1000)),
      film_path: p.film_path,
      voice_id: adVoiceOf(p),
      narrator: p.on_camera_voice === "female" ? "female" : "male",
      lead_offer: agent.lead_goal === "quote" ? "free quote" : "free roof inspection",
      say_as: p.on_camera_name && p.on_camera_pronunciation ? { name: p.on_camera_name, as: p.on_camera_pronunciation } : null,
      look_id: p.look_status === "completed" && p.heygen_look_id && p.look_photo_path === p.photo_paths.at(-1) ? p.heygen_look_id : null,
    },
  };
  return enqueueGeneration({ agentId: agent.id, brief, launchAdsetId: (set?.meta_adset_id as string | undefined) ?? null });
}

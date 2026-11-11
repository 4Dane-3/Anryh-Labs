import "server-only";
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

// The "owner on camera" video: the roofer's choices, the script, and starting a job.

export type Presenter = {
  agent_id: string;
  mode: "film" | "ai" | "none";
  photo_paths: string[];
  job_photo_paths: string[];
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
};

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
  form.append("files", data, "sample.mp3");
  const res = await fetch("https://api.elevenlabs.io/v1/voices/add", { method: "POST", headers: { "xi-api-key": key }, body: form });
  if (!res.ok) throw new Error(`ElevenLabs clone ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return ((await res.json()) as { voice_id: string }).voice_id;
}

type Written = { concept: string; hook_line: string; callout: string; script: string; primary_text: string; headline: string };

/** A 25-second script in the owner's voice, with the ad's text. Uses only the deals and credentials they gave. */
export async function writeScript(agent: Agent): Promise<Written> {
  const [p, b] = await Promise.all([getPresenter(agent.id), getBrandRow(agent.id).catch(() => null)]);
  const towns = p?.towns.length ? p.towns.join(", ") : (agent.service_area ?? "the area");
  const list = (xs: (string | null | undefined)[]) => xs.filter(Boolean).join("; ") || "none";
  const facts = [
    `Deals they gave (feature at most one, the first unless another fits better): ${list(b?.deals.length ? b.deals : [p?.offer])}`,
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
      system: `You write short direct-to-camera Facebook and Instagram Reels ads for local roofing company owners. The owner speaks plainly to neighbors. About 60 words, 25 seconds: the hook in the first sentence, one honest reason to get the roof looked at, who they are (with their certification, if they gave one), and end with "Tap Learn More" for a free inspection. ${ROOFING_HOOK_RULES} Only the inspection is free. Never promise a free roof, never mention paying or waiving an insurance deductible, never mention financing, and never state a price, discount, credential, review count or claim that isn't in the facts. Reply with only JSON: {"concept": "one line", "callout": "2 to 4 word on-screen callout naming the town and who it's for, like Kenmore homeowners", "hook_line": "the first sentence", "script": "...", "primary_text": "2 sentences for the post, opening with the same callout", "headline": "under 40 characters"}.`,
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
export async function startPresenterVideo(agent: Agent) {
  if (!isRoofer(agent)) throw new Error("Presenter videos are for roofing accounts for now.");
  const p = await getPresenter(agent.id);
  if (!p || p.mode === "none") throw new Error("Choose how you want to appear first.");
  if (p.mode === "ai" && !p.consent_at) throw new Error("Give your consent first.");
  if (p.mode === "ai" && !p.photo_paths.length) throw new Error("Upload a headshot or body shot first.");
  if (p.mode === "ai" && !heygenReady()) throw new Error("The AI version isn't switched on yet. Film it yourself for now, or ask us to turn it on.");
  if (p.mode === "film" && !p.film_path) throw new Error("Upload your recording first.");

  const written = await writeScript(agent);
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
      film_path: p.film_path,
      voice_id: p.elevenlabs_voice_id,
      narrator: p.on_camera_voice === "female" ? "female" : "male",
    },
  };
  return enqueueGeneration({ agentId: agent.id, brief, launchAdsetId: (set?.meta_adset_id as string | undefined) ?? null });
}

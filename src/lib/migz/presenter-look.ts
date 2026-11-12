import "server-only";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { callModel, defaultCreateMessage, jsonOf } from "@/lib/migz/router";
import { createLook, createPhotoAvatar, getLook, heygenReady, jobsitePrompt } from "@/lib/heygen";
import { getPresenter } from "@/lib/migz/presenter";

// The person on camera, at a jobsite. Their photo (any photo of them, even a selfie) becomes a HeyGen photo avatar,
// and from it a "look": them standing at a roofing job, waist up, holding a tablet, crew and truck behind. Every
// presenter video is made from the look, so the ad is shot at the job, not in their kitchen. A new photo makes a
// new look; until the look is ready, videos use the plain photo.

const sign = async (path: string) => (await supabaseAdmin.storage.from("creatives").createSignedUrl(path, 6 * 3600)).data?.signedUrl ?? null;

/** A short description of their hair, facial hair and build, so the look keeps them recognizable (a small vision call). */
async function describeLooks(photoUrl: string, agentId: string) {
  const image = Buffer.from(await (await fetch(photoUrl)).arrayBuffer()).toString("base64");
  const res = await callModel({
    task: "creative_traits",
    tier: "haiku",
    agentId,
    runId: null,
    createMessage: defaultCreateMessage,
    params: {
      max_tokens: 1500,
      output_config: { effort: "low", format: { type: "json_schema", schema: { type: "object", additionalProperties: false, required: ["looks"], properties: { looks: { type: "string" } } } } },
      system:
        "Describe only what makes this person recognizable in a photo, for an image model: hair (length, texture, style, colour), facial hair, glasses, face shape and build, in one short comma-separated phrase. Never guess age, ethnicity or anything else about who they are.",
      messages: [{ role: "user", content: [{ type: "image", source: { type: "base64", media_type: "image/jpeg", data: image } }, { type: "text", text: "Describe their look." }] }],
    },
  });
  return jsonOf<{ looks: string }>(res.message)?.looks?.slice(0, 200) ?? null;
}

/** Starts their jobsite look when there isn't one for their newest photo. Safe to call again: it does nothing then. */
export async function ensureJobsiteLook(agentId: string) {
  if (!heygenReady()) return { started: false, reason: "HeyGen isn't connected" };
  const p = await getPresenter(agentId);
  const photo = p?.photo_paths.at(-1);
  if (!p || p.mode !== "ai" || !photo || !p.consent_at) return { started: false, reason: "No consented photo yet" };
  if (p.look_photo_path === photo && p.look_status !== "failed") return { started: false, reason: "Already made for this photo" };
  const url = await sign(photo);
  if (!url) return { started: false, reason: "Couldn't read the photo" };
  const { data: agent } = await supabaseAdmin.from("agents").select("full_name, service_area").eq("id", agentId).single();
  const company = (agent?.full_name as string) ?? "the company";
  const looks = await describeLooks(url, agentId).catch(() => null);
  const avatar = p.heygen_avatar_id && p.look_photo_path === photo ? { avatarId: p.heygen_avatar_id, groupId: p.heygen_group_id ?? "" } : await createPhotoAvatar({ name: `${company} presenter`, imageUrl: url });
  // The photo avatar has to finish before a look can be made from it (usually under a minute)
  for (let i = 0; i < 18; i++) {
    const s = await getLook(avatar.avatarId);
    if (s.status === "completed") break;
    if (s.status === "failed") throw new Error("HeyGen couldn't make the photo avatar from that photo");
    await new Promise((r) => setTimeout(r, 5000));
  }
  const town = p.towns[0] ?? (agent?.service_area as string | null) ?? null;
  const lookId = await createLook({ name: `${company} jobsite`, prompt: jobsitePrompt({ company, town, looks }), avatarId: avatar.avatarId, groupId: avatar.groupId, referenceUrl: url });
  await supabaseAdmin
    .from("agent_presenters")
    .update({ heygen_avatar_id: avatar.avatarId, heygen_group_id: avatar.groupId, heygen_look_id: lookId, look_status: "processing", look_preview_url: null, look_photo_path: photo, updated_at: new Date().toISOString() })
    .eq("agent_id", agentId);
  return { started: true as const, lookId };
}

/** Checks a look that's still being made, and records it when it's ready. */
export async function refreshJobsiteLook(agentId: string) {
  const p = await getPresenter(agentId);
  if (!p?.heygen_look_id || p.look_status !== "processing") return p?.look_status ?? null;
  const l = await getLook(p.heygen_look_id);
  if (l.status === "processing") return "processing";
  const status = l.status === "completed" ? "completed" : "failed";
  await supabaseAdmin.from("agent_presenters").update({ look_status: status, look_preview_url: l.preview_image_url, updated_at: new Date().toISOString() }).eq("agent_id", agentId);
  return status;
}

/** Every look still being made (the creatives cron calls this). */
export async function refreshJobsiteLooks() {
  const { data } = await supabaseAdmin.from("agent_presenters").select("agent_id").eq("look_status", "processing").limit(20);
  const out: Record<string, string | null> = {};
  for (const r of data ?? []) out[r.agent_id as string] = await refreshJobsiteLook(r.agent_id as string).catch((e) => `error: ${e instanceof Error ? e.message : e}`);
  return out;
}

// One-off: swaps the video and copy on one of an agent's live video ads, in place (same ad, same ad set, same
// booking link and tracking). Meta re-reviews the ad; its id and history stay.
// Usage (from the repo root):
//   NODE_PATH=scripts/migz/stubs npx tsx --env-file=.env.local --tsconfig ./tsconfig.json scripts/migz/swap-video-ad.mts miguel-cruz <adId> <video>
//     shows the ad as it is now and changes nothing
//   ... miguel-cruz <adId> <video> --go
//     uploads the video, builds the new creative and puts it on the ad
import { readFile } from "node:fs/promises";

(globalThis as { WebSocket?: unknown }).WebSocket ??= class {};
const { supabaseAdmin } = await import("@/lib/supabase-admin");
const { graph } = await import("@/lib/meta/graph");
const { uploadVideo, videoState, createAdCreative } = await import("@/lib/meta/ads");
const { landingUrl } = await import("@/lib/booking/sites");

const NAME = "Whole life talking head (video)";
const HEADLINE = "Whole life, locked in for life";
const PRIMARY_TEXT =
  "Tomorrow may never come. Lock in a rate that never goes up and leave up to $1 million to the people you love. Book a free call with Miguel.";

const [slug, adId, file, go] = process.argv.slice(2);
if (!slug || !adId || !file) throw new Error("Usage: swap-video-ad.mts <slug> <adId> <video> [--go]");
const { data: agent } = await supabaseAdmin.from("agents").select("*").eq("slug", slug).single();
if (!agent?.meta_ad_account_id) throw new Error(`No agent with slug ${slug}, or it has no Meta ad account`);
const account: string = agent.meta_ad_account_id;

type MetaAd = { id: string; name: string; effective_status: string; adset?: { id: string; name: string }; creative?: { id: string; video_id?: string; url_tags?: string } };
const show = () => graph<MetaAd>("GET", adId, { fields: "id,name,effective_status,adset{id,name},creative{id,video_id,url_tags}" });
const before = await show();
console.log("Now:", JSON.stringify(before, null, 1));
if (!before.creative?.video_id) throw new Error(`Ad ${adId} isn't a video ad`);
if (go !== "--go") process.exit(0);

// The file goes to our library first; Meta fetches it from a short-lived signed URL
const bytes = await readFile(file);
const ext = file.split(".").pop()!.toLowerCase();
const mime = ext === "mov" ? "video/quicktime" : "video/mp4";
const path = `${agent.id}/whole-life-${Date.now()}.${ext}`;
const up = await supabaseAdmin.storage.from("creatives").upload(path, bytes, { contentType: mime });
if (up.error) throw up.error;
const { data: signed } = await supabaseAdmin.storage.from("creatives").createSignedUrl(path, 3600);
if (!signed) throw new Error("Couldn't sign the video URL");
const videoId = await uploadVideo(account, signed.signedUrl, NAME);
console.log(`Uploaded to Meta as video ${videoId}, waiting for processing...`);

let state = await videoState(videoId);
for (let i = 0; (state.status !== "ready" || !state.thumbnail) && i < 60; i++) {
  if (state.status === "error") throw new Error("Meta couldn't process the video");
  await new Promise((r) => setTimeout(r, 10_000));
  state = await videoState(videoId);
}
if (state.status !== "ready" || !state.thumbnail) throw new Error(`Video still ${state.status} after 10 minutes`);

const creativeId = await createAdCreative(account, {
  name: NAME,
  pageId: agent.meta_page_id,
  instagramId: agent.meta_instagram_id,
  link: landingUrl(agent.slug, process.env.APP_URL),
  primaryText: PRIMARY_TEXT,
  headline: HEADLINE,
  media: { kind: "video", videoId, thumbnailUrl: state.thumbnail },
});
await graph("POST", adId, { creative: { creative_id: creativeId }, name: NAME });

// Our own records, so Migz sees the new creative and copy on this ad
const { data: lib } = await supabaseAdmin
  .from("creatives")
  .insert({ agent_id: agent.id, kind: "video", storage_path: path, file_name: file.split("/").pop(), mime_type: mime, size_bytes: bytes.length, status: "live", meta_video_id: videoId })
  .select("id")
  .single();
await supabaseAdmin
  .from("ads")
  .update({ creative_id: lib?.id ?? null, meta_creative_id: creativeId, name: NAME, headline: HEADLINE, primary_text: PRIMARY_TEXT, updated_at: new Date().toISOString() })
  .eq("meta_ad_id", adId);

console.log(`✓ Ad ${adId} now runs creative ${creativeId} (video ${videoId})`);
console.log("After:", JSON.stringify(await show(), null, 1));

// One-off: swaps an agent's live image ads to new images and copy. Each old ad gets a new ad in the same ad
// set (new image, new copy, same booking link and tracking), then the old ad is paused, so its stats stay put.
// Usage (from the repo root):
//   NODE_PATH=scripts/migz/stubs npx tsx --env-file=.env.local --tsconfig ./tsconfig.json scripts/migz/swap-image-ads.mts miguel-cruz
//     lists the agent's ads (id, status, image or video, ad set) and changes nothing
//   ... miguel-cruz <oldAdId>=1 <oldAdId>=2 <oldAdId>=3 <oldAdId>=4
//     swaps each listed ad to creative 1-4 below (the PNGs in .claude/creatives/)
import { readFile } from "node:fs/promises";

(globalThis as { WebSocket?: unknown }).WebSocket ??= class {};
const { supabaseAdmin } = await import("@/lib/supabase-admin");
const { graphAll } = await import("@/lib/meta/graph");
const { uploadImage, createAdCreative, createAd, setStatus } = await import("@/lib/meta/ads");
const { landingUrl } = await import("@/lib/booking/sites");

const CREATIVES: Record<string, { file: string; headline: string; primaryText: string }> = {
  "1": {
    file: ".claude/creatives/1-final-expense-no-exam.png",
    headline: "Rates locked in for life",
    primaryText: "Lock in your rate for life, with no medical exam. Book a free call with Miguel to see your options.",
  },
  "2": {
    file: ".claude/creatives/2-final-expense-living-benefits.png",
    headline: "From $50/month",
    primaryText: "Protect your family from $50 a month. Some policies even pay out while you're living. Book a free call.",
  },
  "3": {
    file: ".claude/creatives/3-whole-life-cash-value.png",
    headline: "Up to $1M in coverage",
    primaryText: "Leave a legacy, with up to $1 million in coverage that builds cash value over time. Book a free call with Miguel.",
  },
  "4": {
    file: ".claude/creatives/4-whole-life-level-premiums.png",
    headline: "A price that never goes up",
    primaryText: "With whole life, your premium never goes up, even as you age. Book a free call to lock yours in.",
  },
};

const [slug, ...pairs] = process.argv.slice(2);
if (!slug) throw new Error("Usage: swap-image-ads.mts <slug> [<oldAdId>=<1-4> ...]");
const { data: agent } = await supabaseAdmin.from("agents").select("*").eq("slug", slug).single();
if (!agent?.meta_ad_account_id) throw new Error(`No agent with slug ${slug}, or it has no Meta ad account`);
const account: string = agent.meta_ad_account_id;

type MetaAd = {
  id: string;
  name: string;
  effective_status: string;
  adset?: { id: string; name: string };
  creative?: { id: string; object_type?: string; video_id?: string; image_url?: string };
};
const ads = await graphAll<MetaAd>(`${account}/ads`, {
  fields: "id,name,effective_status,adset{id,name},creative{id,object_type,video_id,image_url}",
  effective_status: ["ACTIVE", "PAUSED", "PENDING_REVIEW", "WITH_ISSUES", "ADSET_PAUSED", "CAMPAIGN_PAUSED"],
  limit: 100,
});

if (!pairs.length) {
  console.log(`${agent.full_name}'s ads (${account}):\n`);
  for (const ad of ads) {
    const kind = ad.creative?.video_id ? "video" : ad.creative?.object_type?.toLowerCase() ?? "?";
    console.log(`${ad.id}  ${ad.effective_status.padEnd(15)} ${kind.padEnd(6)} ${ad.name}  [ad set: ${ad.adset?.name ?? "?"}]`);
  }
  console.log("\nTo swap: add <adId>=<1-4> for each image ad, matching the picture numbers.");
  process.exit(0);
}

for (const pair of pairs) {
  const [oldId, n] = pair.split("=");
  const c = CREATIVES[n];
  const old = ads.find((a) => a.id === oldId);
  if (!c) throw new Error(`${pair}: the number after = must be 1, 2, 3 or 4`);
  if (!old?.adset) throw new Error(`${pair}: no ad ${oldId} in ${account}`);
  if (old.creative?.video_id) throw new Error(`${pair}: ad ${oldId} is a video ad; this only swaps image ads`);

  const hash = await uploadImage(account, await readFile(c.file), `miguel-feature-${n}`);
  const name = `${c.headline} (image ${n})`;
  const creativeId = await createAdCreative(account, {
    name,
    pageId: agent.meta_page_id,
    instagramId: agent.meta_instagram_id,
    link: landingUrl(agent.slug, process.env.APP_URL),
    primaryText: c.primaryText,
    headline: c.headline,
    media: { kind: "image", imageHash: hash },
  });
  const newId = await createAd(account, { name, adsetId: old.adset.id, creativeId, status: "ACTIVE" });
  await setStatus(oldId, "PAUSED");

  // Our own records, so Migz sees the new ad (scorecards, copy history) and knows the old one is off
  const now = new Date().toISOString();
  const { data: set } = await supabaseAdmin.from("ad_sets").select("id").eq("meta_adset_id", old.adset.id).single();
  const path = `${agent.id}/feature-${n}-${Date.now()}.png`;
  await supabaseAdmin.storage.from("creatives").upload(path, await readFile(c.file), { contentType: "image/png" });
  const { data: lib } = await supabaseAdmin
    .from("creatives")
    .insert({ agent_id: agent.id, kind: "image", storage_path: path, file_name: c.file.split("/").pop(), mime_type: "image/png", size_bytes: (await readFile(c.file)).length, status: "live" })
    .select("id")
    .single();
  await supabaseAdmin.from("ads").insert({
    agent_id: agent.id,
    adset_id: set?.id,
    creative_id: lib?.id ?? null,
    meta_ad_id: newId,
    meta_creative_id: creativeId,
    name,
    status: "ACTIVE",
    primary_text: c.primaryText,
    headline: c.headline,
  });
  await supabaseAdmin.from("ads").update({ status: "PAUSED", updated_at: now }).eq("meta_ad_id", oldId);
  console.log(`✓ ${oldId} (${old.name}) paused → new ad ${newId} "${name}" in ${old.adset.name}`);
}

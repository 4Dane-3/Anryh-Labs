import "server-only";
import { graph, graphAll } from "@/lib/meta/graph";

// The Marketing API operations Migz uses. Every campaign is created under the Financial Products &
// Services special ad category (required in the US for insurance), which rules out age, gender and
// ZIP targeting: targeting here is licensed states only.

export type Placement =
  | "facebook_feed"
  | "facebook_reels"
  | "facebook_stories"
  | "instagram_feed"
  | "instagram_reels"
  | "instagram_stories";

export const PLACEMENTS: Placement[] = [
  "facebook_feed",
  "facebook_reels",
  "facebook_stories",
  "instagram_feed",
  "instagram_reels",
  "instagram_stories",
];

const PLACEMENT_POSITIONS: Record<Placement, { platform: "facebook" | "instagram"; position: string }> = {
  facebook_feed: { platform: "facebook", position: "feed" },
  facebook_reels: { platform: "facebook", position: "facebook_reels" },
  facebook_stories: { platform: "facebook", position: "story" },
  instagram_feed: { platform: "instagram", position: "stream" },
  instagram_reels: { platform: "instagram", position: "reels" },
  instagram_stories: { platform: "instagram", position: "story" },
};

// Ads only ever run on Facebook and Instagram. Meta's fully automatic placements also include the
// Audience Network (ads inside other apps and games) and Messenger: there, clicks are cheap but mostly
// accidental or paid for (rewarded video), so they eat the budget and never book. Never use them.
export const PLATFORMS = ["facebook", "instagram"] as const;

/**
 * Targeting fields for placements. An empty list means automatic placements, but only within
 * Facebook and Instagram: Meta picks the positions there, never the Audience Network or Messenger.
 */
export function placementTargeting(placements: Placement[]) {
  if (!placements.length) return { publisher_platforms: [...PLATFORMS] };
  const fb = placements.filter((p) => PLACEMENT_POSITIONS[p].platform === "facebook");
  const ig = placements.filter((p) => PLACEMENT_POSITIONS[p].platform === "instagram");
  return {
    publisher_platforms: [...(fb.length ? ["facebook"] : []), ...(ig.length ? ["instagram"] : [])],
    ...(fb.length ? { facebook_positions: fb.map((p) => PLACEMENT_POSITIONS[p].position) } : {}),
    ...(ig.length ? { instagram_positions: ig.map((p) => PLACEMENT_POSITIONS[p].position) } : {}),
  };
}

const STATE_NAMES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado",
  CT: "Connecticut", DE: "Delaware", DC: "District of Columbia", FL: "Florida", GA: "Georgia",
  HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky",
  LA: "Louisiana", ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota",
  MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire",
  NJ: "New Jersey", NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota",
  OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island",
  SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont",
  VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
};

const regionKeyCache = new Map<string, string>();

/** Meta's numeric region keys for US state abbreviations (looked up once per process). */
export async function stateRegionKeys(states: string[]) {
  const keys: { key: string }[] = [];
  for (const abbr of states) {
    const name = STATE_NAMES[abbr];
    if (!name) continue;
    let key = regionKeyCache.get(abbr);
    if (!key) {
      const res = await graph<{ data: { key: string; name: string; type: string; country_code: string }[] }>(
        "GET",
        "search",
        { type: "adgeolocation", location_types: ["region"], country_code: "US", q: name },
      );
      key = res.data.find((d) => d.type === "region" && d.country_code === "US" && d.name === name)?.key;
      if (!key) throw new Error(`Meta has no region key for ${name}`);
      regionKeyCache.set(abbr, key);
    }
    keys.push({ key });
  }
  return keys;
}

export async function createCampaign(account: string, name: string) {
  const res = await graph<{ id: string }>("POST", `${account}/campaigns`, {
    name,
    objective: "OUTCOME_LEADS",
    status: "PAUSED", // activated after its first ad set and ads exist
    special_ad_categories: ["FINANCIAL_PRODUCTS_SERVICES"],
    special_ad_category_country: ["US"],
    is_adset_budget_sharing_enabled: false,
  });
  return res.id;
}

export async function createAdSet(
  account: string,
  input: {
    campaignId: string;
    name: string;
    dailyBudgetCents: number;
    pixelId: string;
    states: string[];
    placements: Placement[];
    status: "ACTIVE" | "PAUSED";
    /** ISO time Meta stops delivery by itself (the batch's last day), so spend ends even if we're down. */
    endTime?: string | null;
  },
) {
  const regions = await stateRegionKeys(input.states);
  if (!regions.length) throw new Error("The agent has no licensed states to target.");
  const res = await graph<{ id: string }>("POST", `${account}/adsets`, {
    campaign_id: input.campaignId,
    name: input.name,
    daily_budget: input.dailyBudgetCents, // minor units (cents) for USD accounts
    billing_event: "IMPRESSIONS",
    optimization_goal: "OFFSITE_CONVERSIONS",
    bid_strategy: "LOWEST_COST_WITHOUT_CAP",
    destination_type: "WEBSITE",
    // Optimize for leads: booked calls and quote requests both send a "Lead" event via the Conversions API.
    // Bookings alone are too rare for Meta to learn from at our budgets; booked calls stay the scoreboard.
    promoted_object: { pixel_id: input.pixelId, custom_event_type: "LEAD" },
    targeting: {
      geo_locations: { regions },
      age_min: 18,
      // Special ad categories require an explicit choice; keep audience expansion off
      targeting_automation: { advantage_audience: 0 },
      ...placementTargeting(input.placements),
    },
    status: input.status,
    ...(input.endTime ? { end_time: input.endTime } : {}),
  });
  return res.id;
}

/** Changes the conversion an ad set optimizes for (restarts its learning). */
export async function setOptimizationEvent(adsetId: string, pixelId: string, event: "LEAD" | "SCHEDULE") {
  await graph("POST", adsetId, { promoted_object: { pixel_id: pixelId, custom_event_type: event } });
}

/** Sets when Meta stops delivering an ad set. Moving it later restarts a completed ad set. */
export async function setEndTime(adsetId: string, endTime: string) {
  await graph("POST", adsetId, { end_time: endTime });
}

export async function getAdSet(adsetId: string) {
  return graph<{
    id: string;
    status: string;
    daily_budget?: string;
    targeting?: Record<string, unknown>;
    learning_stage_info?: { status?: string };
  }>("GET", adsetId, { fields: "status,daily_budget,targeting,learning_stage_info" });
}

export async function setDailyBudget(adsetId: string, cents: number) {
  await graph("POST", adsetId, { daily_budget: cents });
}

export async function setPlacements(adsetId: string, placements: Placement[]) {
  // Targeting is replaced wholesale on update, so start from the current spec
  const current = await getAdSet(adsetId);
  const targeting = { ...(current.targeting ?? {}) };
  delete targeting.publisher_platforms;
  delete targeting.facebook_positions;
  delete targeting.instagram_positions;
  delete targeting.audience_network_positions;
  delete targeting.messenger_positions;
  await graph("POST", adsetId, { targeting: { ...targeting, ...placementTargeting(placements) } });
}

/** True when an ad set's targeting can deliver outside Facebook and Instagram (no platform list counts). */
export function reachesOtherApps(targeting: Record<string, unknown> | undefined) {
  const platforms = targeting?.publisher_platforms;
  if (!Array.isArray(platforms) || !platforms.length) return true;
  return platforms.some((p) => !(PLATFORMS as readonly string[]).includes(String(p)));
}

/** Takes an ad set off the Audience Network and Messenger, keeping its Facebook and Instagram positions. */
export async function keepToFacebookAndInstagram(adsetId: string) {
  const current = await getAdSet(adsetId);
  if (!reachesOtherApps(current.targeting)) return false;
  const targeting = { ...(current.targeting ?? {}) };
  const kept = Array.isArray(targeting.publisher_platforms)
    ? (targeting.publisher_platforms as string[]).filter((p) => (PLATFORMS as readonly string[]).includes(p))
    : [];
  delete targeting.audience_network_positions;
  delete targeting.messenger_positions;
  targeting.publisher_platforms = kept.length ? kept : [...PLATFORMS];
  await graph("POST", adsetId, { targeting });
  return true;
}

/** Re-targets an ad set to a set of states, keeping the rest of its targeting (placements etc.). */
export async function setStates(adsetId: string, states: string[]) {
  const regions = await stateRegionKeys(states);
  if (!regions.length) throw new Error("No licensed states to target.");
  const current = await getAdSet(adsetId);
  const targeting = { ...(current.targeting ?? {}) };
  await graph("POST", adsetId, { targeting: { ...targeting, geo_locations: { regions } } });
}

export async function setStatus(objectId: string, status: "ACTIVE" | "PAUSED") {
  await graph("POST", objectId, { status });
}

/** Starts an upload from a URL Meta can fetch (we pass a short-lived signed Storage URL). */
export async function uploadVideo(account: string, fileUrl: string, name: string) {
  const res = await graph<{ id: string }>("POST", `${account}/advideos`, { file_url: fileUrl, name });
  return res.id;
}

/** Videos are processed asynchronously; ads can only use them once ready. */
export async function videoState(videoId: string) {
  const [video, thumbs] = await Promise.all([
    graph<{ status?: { video_status?: string } }>("GET", videoId, { fields: "status" }),
    graph<{ data: { uri: string; is_preferred: boolean }[] }>("GET", `${videoId}/thumbnails`).catch(() => ({ data: [] })),
  ]);
  const thumbnail = thumbs.data.find((t) => t.is_preferred)?.uri ?? thumbs.data[0]?.uri ?? null;
  return { status: video.status?.video_status ?? "processing", thumbnail };
}

export async function uploadImage(account: string, bytes: Buffer, name: string) {
  const res = await graph<{ images: Record<string, { hash: string }> }>("POST", `${account}/adimages`, {
    bytes: bytes.toString("base64"),
    name,
  });
  const first = Object.values(res.images)[0];
  if (!first) throw new Error("Meta returned no image hash");
  return first.hash;
}

export async function createAdCreative(
  account: string,
  input: {
    name: string;
    pageId: string;
    instagramId?: string | null;
    link: string;
    primaryText: string;
    headline: string;
    media:
      | { kind: "video"; videoId: string; thumbnailUrl: string }
      | { kind: "image"; imageHash: string }
      | { kind: "carousel"; cards: { imageHash: string; headline: string }[] };
  },
) {
  const callToAction = { type: process.env.META_CTA_TYPE || "BOOK_NOW", value: { link: input.link } };
  const page = { page_id: input.pageId, ...(input.instagramId ? { instagram_user_id: input.instagramId } : {}) };
  const objectStorySpec =
    input.media.kind === "carousel"
      ? {
          ...page,
          link_data: {
            link: input.link,
            message: input.primaryText,
            // Each card links to the booking page; keep the cards in the order Migz wrote them
            child_attachments: input.media.cards.map((c) => ({ link: input.link, image_hash: c.imageHash, name: c.headline, call_to_action: callToAction })),
            multi_share_optimized: false,
            multi_share_end_card: false,
            call_to_action: callToAction,
          },
        }
      : input.media.kind === "video"
      ? {
          page_id: input.pageId,
          ...(input.instagramId ? { instagram_user_id: input.instagramId } : {}),
          video_data: {
            video_id: input.media.videoId,
            image_url: input.media.thumbnailUrl,
            message: input.primaryText,
            title: input.headline,
            call_to_action: callToAction,
          },
        }
      : {
          page_id: input.pageId,
          ...(input.instagramId ? { instagram_user_id: input.instagramId } : {}),
          link_data: {
            image_hash: input.media.imageHash,
            link: input.link,
            message: input.primaryText,
            name: input.headline,
            call_to_action: callToAction,
          },
        };

  const res = await graph<{ id: string }>("POST", `${account}/adcreatives`, {
    name: input.name,
    object_story_spec: objectStorySpec,
    // Meta fills these macros per ad; the landing page stores them, so bookings are attributed per ad and placement
    // utm_term carries where the ad was shown (e.g. Instagram_Reels), so bookings are attributed per platform too
    url_tags: "utm_source=meta&utm_medium=paid&utm_campaign={{campaign.id}}&utm_content={{ad.id}}&utm_term={{placement}}",
  });
  return res.id;
}

export async function createAd(
  account: string,
  input: { name: string; adsetId: string; creativeId: string; status: "ACTIVE" | "PAUSED" },
) {
  const res = await graph<{ id: string }>("POST", `${account}/ads`, {
    name: input.name,
    adset_id: input.adsetId,
    creative: { creative_id: input.creativeId },
    status: input.status,
  });
  return res.id;
}

type ActionStat = { action_type: string; value: string };

export type AdInsightRow = {
  ad_id: string;
  adset_id: string;
  campaign_id: string;
  date_start: string;
  spend?: string;
  impressions?: string;
  clicks?: string;
  reach?: string;
  frequency?: string;
  inline_link_clicks?: string;
  actions?: ActionStat[];
  video_play_actions?: ActionStat[];
  video_thruplay_watched_actions?: ActionStat[];
  video_p25_watched_actions?: ActionStat[];
  video_p50_watched_actions?: ActionStat[];
  video_p75_watched_actions?: ActionStat[];
  video_p100_watched_actions?: ActionStat[];
  video_avg_time_watched_actions?: ActionStat[];
};

export type PlacementInsightRow = AdInsightRow & { publisher_platform: string; platform_position: string };

// 3-second views come back as actions[action_type=video_view]; the video_* fields are lists of
// {action_type: "video_view", value}. Field names checked against the Insights API (v25.0).
const AD_FIELDS = [
  "ad_id",
  "adset_id",
  "campaign_id",
  "spend",
  "impressions",
  "clicks",
  "reach",
  "frequency",
  "inline_link_clicks",
  "actions",
  "video_play_actions",
  "video_thruplay_watched_actions",
  "video_p25_watched_actions",
  "video_p50_watched_actions",
  "video_p75_watched_actions",
  "video_p100_watched_actions",
  "video_avg_time_watched_actions",
].join(",");

/** Daily, per-ad insights for a date range (inclusive, account timezone). */
export async function getAdInsights(account: string, since: string, until: string) {
  return graphAll<AdInsightRow>(`${account}/insights`, {
    level: "ad",
    time_increment: 1,
    time_range: { since, until },
    fields: AD_FIELDS,
    limit: 500,
  });
}

/** Daily, per-ad results split by where the ad ran (Facebook Feed, Instagram Reels, ...). */
export async function getPlacementInsights(account: string, since: string, until: string) {
  return graphAll<PlacementInsightRow>(`${account}/insights`, {
    level: "ad",
    time_increment: 1,
    time_range: { since, until },
    breakdowns: "publisher_platform,platform_position",
    fields: "ad_id,spend,impressions,inline_link_clicks,actions,video_thruplay_watched_actions",
    limit: 500,
  });
}

/** Sums an action list, optionally for one action_type. */
export function actionValue(list: ActionStat[] | undefined, type?: string) {
  return (list ?? [])
    .filter((a) => !type || a.action_type === type)
    .reduce((s, a) => s + (Number(a.value) || 0), 0);
}

/** Meta-attributed "Schedule" conversions in an insights row (pixel + CAPI events). */
export function scheduleConversions(row: AdInsightRow) {
  return (row.actions ?? [])
    .filter((a) => a.action_type.toLowerCase().includes("schedule"))
    .reduce((max, a) => Math.max(max, Number(a.value) || 0), 0);
}

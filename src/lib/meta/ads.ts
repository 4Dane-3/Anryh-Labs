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

/** Targeting fields for manual placements; an empty list means Advantage+ (automatic) placements. */
function placementTargeting(placements: Placement[]) {
  if (!placements.length) return {};
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
    // Optimize for booked calls: the landing page sends a "Schedule" event via the Conversions API
    promoted_object: { pixel_id: input.pixelId, custom_event_type: "SCHEDULE" },
    targeting: {
      geo_locations: { regions },
      age_min: 18,
      // Special ad categories require an explicit choice; keep audience expansion off
      targeting_automation: { advantage_audience: 0 },
      ...placementTargeting(input.placements),
    },
    status: input.status,
  });
  return res.id;
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
  await graph("POST", adsetId, { targeting: { ...targeting, ...placementTargeting(placements) } });
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
    media: { kind: "video"; videoId: string; thumbnailUrl: string } | { kind: "image"; imageHash: string };
  },
) {
  const callToAction = { type: process.env.META_CTA_TYPE || "BOOK_NOW", value: { link: input.link } };
  const objectStorySpec =
    input.media.kind === "video"
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
    // Meta fills these macros per ad; the landing page stores them, so bookings are attributed per ad
    url_tags: "utm_source=meta&utm_medium=paid&utm_campaign={{campaign.id}}&utm_content={{ad.id}}",
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

export type AdInsightRow = {
  ad_id: string;
  adset_id: string;
  campaign_id: string;
  date_start: string;
  spend?: string;
  impressions?: string;
  clicks?: string;
  actions?: { action_type: string; value: string }[];
};

/** Daily, per-ad insights for a date range (inclusive, account timezone). */
export async function getAdInsights(account: string, since: string, until: string) {
  return graphAll<AdInsightRow>(`${account}/insights`, {
    level: "ad",
    time_increment: 1,
    time_range: { since, until },
    fields: "ad_id,adset_id,campaign_id,spend,impressions,clicks,actions",
    limit: 500,
  });
}

/** Meta-attributed "Schedule" conversions in an insights row (pixel + CAPI events). */
export function scheduleConversions(row: AdInsightRow) {
  return (row.actions ?? [])
    .filter((a) => a.action_type.toLowerCase().includes("schedule"))
    .reduce((max, a) => Math.max(max, Number(a.value) || 0), 0);
}

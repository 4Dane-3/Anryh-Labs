// Two agent choices that shape how Migz builds their ads. Pure (client-safe): settings, Start here and the
// batch planner show the same words and prices the server charges.

// ---------- Intent level ----------

export type IntentLevel = "low_medium" | "medium_high";
export const DEFAULT_INTENT: IntentLevel = "medium_high";
export const isIntentLevel = (v: unknown): v is IntentLevel => v === "low_medium" || v === "medium_high";

export const INTENT_LEVELS: Record<IntentLevel, { title: string; short: string; detail: string }> = {
  medium_high: {
    title: "Booked calls (medium–high intent)",
    short: "Booked calls",
    detail:
      "Every ad sends people to your booking page to pick a time. Fewer leads, and each one costs more, but they've chosen a time to talk, so more of them show up ready.",
  },
  low_medium: {
    title: "More leads (low–medium intent)",
    short: "More leads",
    detail:
      "Migz also runs instant-form ads: people send their name and number without leaving Facebook or Instagram. You get more leads for the money, but many are early and you call them back, so fewer turn into a real conversation.",
  },
};

/** An ad set needs at least this much a day to split into a booking-page ad set and an instant-form one. */
export const MIN_SPLIT_DAILY_CENTS = 1000;

// ---------- Video quality ----------

export type VideoTier = "standard" | "seedance_15" | "seedance_30";
export const DEFAULT_VIDEO_TIER: VideoTier = "standard";
export const isVideoTier = (v: unknown): v is VideoTier => v === "standard" || v === "seedance_15" || v === "seedance_30";

export const VIDEO_TIERS: Record<VideoTier, { title: string; model: "kling" | "seedance"; seconds: number; priceCents: number; detail: string }> = {
  standard: {
    title: "Standard (included)",
    model: "kling",
    seconds: 15,
    priceCents: 0,
    detail: "Kling 3.0 at 720p, up to 15 seconds. Included: nothing extra comes out of your ad funds.",
  },
  seedance_15: {
    title: "Seedance 2.5 · 15s",
    model: "seedance",
    seconds: 15,
    priceCents: 600,
    detail: "Better-looking, more lifelike video at 720p, up to 15 seconds.",
  },
  seedance_30: {
    title: "Seedance 2.5 · 30s",
    model: "seedance",
    seconds: 30,
    priceCents: 1200,
    detail: "The same quality with room for a longer story, up to 30 seconds.",
  },
};

/**
 * The most Seedance videos one ad set is charged for in a week. Migz makes new creatives at batch setup and in
 * a weekly refresh of ad sets whose ads are under 2.5% CTR, at most one video per review, so this is usually
 * one; the cap stops a bad week (rejected ads, nothing live) from making video after video. Past it, videos
 * are made on Standard.
 */
export const MAX_PAID_VIDEOS_PER_ADSET_PER_WEEK = 2;

export const videoPrice = (tier: VideoTier) => VIDEO_TIERS[tier].priceCents;

/** What a batch needs free on top of its budget: the video Migz makes when it sets the batch up. */
export const setupVideoCents = (tier: VideoTier) => videoPrice(tier);

const usd = (cents: number) => `$${(cents / 100).toFixed(cents % 100 ? 2 : 0)}`;

/** The one line that states the charge, shown wherever the agent picks or confirms a tier. */
export function videoChargeLine(tier: VideoTier) {
  const t = VIDEO_TIERS[tier];
  if (!t.priceCents) return "Videos are included. Nothing extra is taken from your ad funds.";
  return `Each Seedance video costs ${usd(t.priceCents)}, taken from your ad funds when Migz starts making it (refunded if it can't be made), and shown in your funds history. That includes the videos Migz makes later: for each new batch, and in its weekly refresh of ads that get under 2.5% of viewers to click. At most ${MAX_PAID_VIDEOS_PER_ADSET_PER_WEEK} a week per ad set; past that, or if your free balance can't cover one, Migz makes it on Standard instead. Refunded if Meta rejects the ad.`;
}

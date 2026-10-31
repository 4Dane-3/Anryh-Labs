// Meta's Advantage+ creative enhancements: Meta rewrites text, touches up or animates images, adds music,
// overlays and so on, on by default for many of them. For insurance, rewritten text can change a claim (and get
// the ad rejected), and edited images distort Migz's work, so every creative Migz makes opts out of all of them.
//
// Keys from the AdCreativeFeaturesSpec reference and the Advantage+ creative guide (checked Oct 2026, v25/v26).
// Left alone: adapt_to_placement (Meta's crop of the same image to 4:5 / 9:16 placements, no new pixels) and
// video_auto_crop (the same for video). Catalog-only keys aren't sent. standard_enhancements isn't sent either:
// it was retired in v22.0, and Meta applies it only when it reads OPT_IN.
export const ENHANCEMENTS_OFF = [
  // Text
  "text_optimizations",
  "text_translation",
  "text_extraction_for_headline",
  "text_extraction_for_tap_target",
  "description_automation",
  "show_summary",
  "show_destination_blurbs",
  "enhance_cta",
  "generate_cta",
  "inline_comment",
  // Images
  "image_touchups",
  "image_brightness_and_contrast",
  "image_animation",
  "image_background_gen",
  "image_uncrop",
  "image_templates",
  "image_text_translation",
  "text_overlay_translation",
  "replace_media_text",
  "add_text_overlay",
  "creative_stickers",
  "multi_photo_to_video",
  "media_type_automation",
  // Video and sound
  "video_uncrop",
  "video_filtering",
  "video_highlights",
  "video_to_image",
  "translate_voiceover",
  "music_generation",
  // Extras Meta attaches to the ad
  "reveal_details_over_time",
  "site_extensions",
  "profile_card",
  "profile_extension",
  "biz_ai",
  "ads_with_benefits",
  "pac_relaxation",
] as const;

/** The degrees_of_freedom_spec that opts out of each feature named. */
export function enhancementsOptOut(keys: readonly string[] = ENHANCEMENTS_OFF) {
  return { creative_features_spec: Object.fromEntries(keys.map((k) => [k, { enroll_status: "OPT_OUT" }])) };
}

/**
 * When Meta refuses a creative because of a feature in the spec (a key renamed or retired in a newer version),
 * which of ours it named, or "spec" when it blamed the spec without naming one. null: not about the spec.
 */
export function refusedFeature(message: string, keys: readonly string[]): string | "spec" | null {
  const named = keys.filter((k) => new RegExp(`\\b${k}\\b`).test(message)).sort((a, b) => b.length - a.length)[0];
  if (named) return named;
  return /degrees_of_freedom_spec|creative_features_spec|enroll_status/i.test(message) ? "spec" : null;
}

type FeatureSpec = Record<string, { enroll_status?: string } | undefined>;

/**
 * The enhancements still switched on in a creative as Meta reports it (GET degrees_of_freedom_spec): anything
 * reading OPT_IN, apart from the placement crops we leave on. A key Meta drops from the response isn't
 * counted, since Meta strips features that don't apply to the ad.
 */
export function enhancementsOn(spec: { creative_features_spec?: FeatureSpec } | null | undefined) {
  const features = spec?.creative_features_spec ?? {};
  return Object.entries(features)
    .filter(([k, v]) => v?.enroll_status === "OPT_IN" && !KEPT_ON.has(k))
    .map(([k]) => k)
    .sort();
}
const KEPT_ON = new Set(["adapt_to_placement", "video_auto_crop"]);

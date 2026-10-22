import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { PLACEMENTS, type Placement } from "@/lib/meta/ads";
import {
  CAROUSEL_CARDS,
  HOOK_SECONDS,
  MAX_BUTTON_CHARS,
  MAX_CARD_LINES,
  MAX_OVERLAY_LINE_CHARS,
  MAX_OVERLAY_LINES,
  MAX_VIDEO_SECONDS,
  textOnImage,
  type CarouselBrief,
  type CreativeBrief,
  type ImageBrief,
} from "@/lib/migz/brief";
import {
  checkActionBudget,
  checkBudgetChange,
  checkCopy,
  checkGeneration,
  checkLaunchTarget,
  checkPauseAd,
  MAX_COPY_VARIANTS,
  checkPlacements,
  checkResumeAd,
  type GuardContext,
} from "@/lib/migz/guardrails";
import { isTopic, TOPIC_KEYS } from "@/lib/migz/topics";

// The actions Migz can take, as Claude tools. Every call is validated (shape, guardrails, ad copy
// rules) before anything happens; a rejected call returns the reason so Claude can adapt.

const titleAndReason = {
  title: {
    type: "string",
    description:
      "What you did, for the agent's activity feed: past tense, plain English, under 70 characters. E.g. 'Paused image ad B', 'Moved $6/day to the mortgage-protection video'.",
  },
  reason: {
    type: "string",
    description:
      "Why, in one or two short sentences with the numbers that drove it. E.g. 'Click-through rate was 0.41% after 2,100 impressions, a third of the other ads.'",
  },
} as const;

// Anthropic compiles every strict tool's schema into one grammar, and rejects the request when the
// total is too large ("compiled grammar is too large"). 18 strict tools was over the limit, 9 is fine,
// so strict is kept for the original action tools and the rest rely on evaluate() / their own
// validation, which runs on every call anyway. scripts/migz/probe-tools.mts checks the live API.
export const MAX_STRICT_TOOLS = 10;

function tool(name: string, description: string, properties: Record<string, unknown>, strict = true): Anthropic.Beta.BetaTool {
  return {
    name,
    description,
    strict,
    input_schema: {
      type: "object",
      properties: { ...properties, ...titleAndReason },
      required: [...Object.keys(properties), "title", "reason"],
      additionalProperties: false,
    },
  };
}

const shotSchema = {
  type: "object",
  properties: {
    prompt: { type: "string", description: "What the camera sees in this shot: people, setting, action, mood." },
    duration: { type: "integer", description: "Seconds, 2 to 6." },
  },
  required: ["prompt", "duration"],
  additionalProperties: false,
};

export const MIGZ_TOOLS: Anthropic.Beta.BetaTool[] = [
  tool("adjust_daily_budget", "Change an ad set's daily budget. Total across active ad sets must stay within the agent's daily budget cap; each change at most 30%; not allowed while an ad set is learning.", {
    adset_id: { type: "string" },
    daily_budget_usd: { type: "number", description: "New daily budget in dollars." },
  }),
  tool("pause_ad", "Pause an underperforming ad. Needs enough data (1,000+ impressions or $15+ spend) and another live ad in the same ad set.", {
    ad_id: { type: "string" },
  }),
  tool("resume_ad", "Turn a paused ad back on.", {
    ad_id: { type: "string" },
  }),
  tool("set_placements", "Set where an ad set's ads appear. An empty list means automatic (Advantage+) placements, usually the best default. Not allowed while learning.", {
    adset_id: { type: "string" },
    placements: { type: "array", items: { type: "string", enum: PLACEMENTS } },
  }),
  tool(
    "generate_video",
    `Have Higgsfield make a new 9:16 video ad: one ${HOOK_SECONDS}-second hook shot, then 1-3 body shots (total ${MAX_VIDEO_SECONDS}s max). Use for new angles, or when the agent has no creatives. Shots show relatable scenes (families, homes, everyday moments); never depict a specific real person or the agent.`,
    {
      concept: { type: "string", description: "The angle in one line, e.g. 'Mortgage protection for new homeowners'." },
      topic: {
        type: "string",
        enum: [...TOPIC_KEYS, "other"],
        description: "The advertising topic this creative serves. Use the agent's ad focus unless there's a clear reason not to.",
      },
      style: { type: "string", description: "Visual direction for every shot, e.g. 'warm natural light, handheld, documentary feel'." },
      hook_line: { type: "string", description: "The opening idea in words; it also starts the primary text." },
      hook_shot: { type: "string", description: `Prompt for the first ${HOOK_SECONDS} seconds; must stop the scroll.` },
      body_shots: { type: "array", items: shotSchema, description: "1 to 3 shots." },
      primary_text: { type: "string", description: "Ad copy above the video, starting with the hook line. Under 300 characters." },
      headline: { type: "string", description: "Short headline under the video, under 40 characters." },
      launch_adset_id: {
        type: ["string", "null"],
        description: "Ad set to launch it into once ready, or null to keep it in the creative library.",
      },
    },
  ),
  tool(
    "new_hook_variant",
    "Make a version of a winning Migz video with the same body shots and a new first 3 seconds, then launch it alongside the original. Only for ads where can_make_hook_variants is true.",
    {
      source_ad_id: { type: "string" },
      hook_line: { type: "string" },
      hook_shot: { type: "string" },
      primary_text: { type: "string", description: "Copy for the variant, starting with the new hook line." },
    },
  ),
  tool(
    "generate_image",
    `Have Higgsfield make a still image ad. 4:5 (Facebook and Instagram feeds): a candid lifestyle photo with 1 to ${MAX_OVERLAY_LINES} short lines of text laid out above the people, plus an optional button-shaped label; the text layout and spelling instructions are added for you. 9:16 (Stories and Reels slides): a photo only, made by a different model that doesn't render text, so leave overlay_lines empty and set button_text to null; the message lives in the primary text and headline. Cheaper and faster than video, so it's a good way to test a message; run images alongside videos rather than instead of them.`,
    {
      concept: { type: "string", description: "The angle in one line, e.g. 'Peace of mind for young parents'." },
      topic: {
        type: "string",
        enum: [...TOPIC_KEYS, "other"],
        description: "The advertising topic this creative serves. Use the agent's ad focus unless there's a clear reason not to.",
      },
      scene: {
        type: "string",
        description:
          "The photo: who is in it, where, doing what, and the light. Relatable, unposed moments (families, homes, everyday life); never a specific real person or the agent. Don't mention text here.",
      },
      style: { type: "string", description: "Photographic look, e.g. 'warm, cinematic golden-hour lifestyle, shallow depth of field, soft film grain'." },
      overlay_lines: {
        type: "array",
        items: { type: "string" },
        description: `For 4:5: 1 to ${MAX_OVERLAY_LINES} short lines shown on the image, each under ${MAX_OVERLAY_LINE_CHARS} characters, read top to bottom. E.g. ["Prepare for the worst.", "Protect their peace.", "Get life insurance."]. For 9:16: an empty list (these images carry no text).`,
      },
      button_text: {
        type: ["string", "null"],
        description: `Text for a button-shaped label at the bottom, under ${MAX_BUTTON_CHARS} characters (e.g. "Book a free call"), or null for none. Meta adds the real clickable button separately.`,
      },
      aspect_ratio: { type: "string", enum: ["4:5", "9:16"], description: "4:5 for Facebook and Instagram feeds (the default); 9:16 for Stories and Reels." },
      primary_text: { type: "string", description: "Ad copy above the image. Under 300 characters; carry the detail here, not on the image." },
      headline: { type: "string", description: "Short headline under the image, under 40 characters." },
      launch_adset_id: {
        type: ["string", "null"],
        description: "Ad set to launch it into once ready, or null to keep it in the creative library.",
      },
    },
  ),
  tool(
    "generate_carousel",
    `Have Higgsfield make a ${CAROUSEL_CARDS}-card carousel ad: square photos people swipe through, each with 1 to ${MAX_CARD_LINES} short lines of text and its own headline. Use it when a message works better as two beats than one image: a problem then the answer, two sides of one topic, or now versus later. Exactly ${CAROUSEL_CARDS} cards (the most allowed). It counts as one creative and launches straight into an ad set.`,
    {
      concept: { type: "string", description: "The idea across both cards in one line, e.g. 'What happens to the mortgage vs. what coverage does'." },
      topic: {
        type: "string",
        enum: [...TOPIC_KEYS, "other"],
        description: "The advertising topic this creative serves. Use the agent's ad focus unless there's a clear reason not to.",
      },
      style: { type: "string", description: "One photographic look for both cards, e.g. 'warm natural light, candid documentary lifestyle'." },
      cards: {
        type: "array",
        items: {
          type: "object",
          properties: {
            scene: { type: "string", description: "This card's photo: who, where, doing what, the light. Never a specific real person or the agent; don't mention text here." },
            overlay_lines: { type: "array", items: { type: "string" }, description: `1 to ${MAX_CARD_LINES} short lines on this card, each under ${MAX_OVERLAY_LINE_CHARS} characters.` },
            headline: { type: "string", description: "This card's headline under the image, under 40 characters." },
          },
          required: ["scene", "overlay_lines", "headline"],
          additionalProperties: false,
        },
        description: `Exactly ${CAROUSEL_CARDS} cards, in swipe order.`,
      },
      primary_text: { type: "string", description: "Ad copy above the carousel. Under 300 characters." },
      launch_adset_id: { type: "string", description: "The ad set to launch it into once both cards are made." },
    },
    false,
  ),
  tool("launch_creative", "Launch a creative from creatives_not_running (agent uploads first: real footage of the agent usually performs best) as a new ad.", {
    creative_id: { type: "string" },
    adset_id: { type: "string" },
    primary_text: { type: "string" },
    headline: { type: "string" },
  }),
  tool(
    "write_copy_variants",
    `Test new primary text and headline on an existing creative: creates up to ${MAX_COPY_VARIANTS} new ads in the same ad set reusing the source ad's video or image. Use when people watch but don't click.`,
    {
      source_ad_id: { type: "string" },
      variants: {
        type: "array",
        items: {
          type: "object",
          properties: {
            primary_text: { type: "string", description: "Under 300 characters." },
            headline: { type: "string", description: "Under 40 characters." },
          },
          required: ["primary_text", "headline"],
          additionalProperties: false,
        },
        description: `1 to ${MAX_COPY_VARIANTS} variants.`,
      },
    },
    false,
  ),
  tool("hold", "Record a deliberate decision not to change something, e.g. while ad sets are learning or results are steady. Use once per review at most.", {
    kind: { type: "string", enum: ["budget", "creative", "audience", "other"] },
  }),
];

// ---------- validation ----------

export type ActionPayload =
  | { tool: "adjust_daily_budget"; adset_id: string; cents: number }
  | { tool: "pause_ad" | "resume_ad"; ad_id: string }
  | { tool: "set_placements"; adset_id: string; placements: Placement[] }
  | { tool: "generate_video" | "new_hook_variant"; brief: CreativeBrief; launch_adset_id: string | null; parent_creative_id: string | null }
  | { tool: "generate_image"; brief: ImageBrief; launch_adset_id: string | null; parent_creative_id: null }
  | { tool: "generate_carousel"; brief: CarouselBrief; launch_adset_id: string; parent_creative_id: null }
  | { tool: "launch_creative"; creative_id: string; adset_id: string; primary_text: string; headline: string }
  | { tool: "write_copy_variants"; source_ad_id: string; adset_id: string; variants: { primary_text: string; headline: string }[] }
  | { tool: "hold" };

export type EvalContext = GuardContext & {
  /** Ad id -> its ad set, for ads whose creative already has Meta media (video id / image hash) to reuse. */
  reusableAds?: Map<string, string>;
  /** Ads whose creative has a Migz brief, for hook variants. */
  scriptedAds: Map<string, { creative_id: string; script: CreativeBrief; meta_adset_id: string }>;
  libraryCreativeIds: Set<string>;
};

export type Evaluated =
  | { ok: true; kind: string; title: string; detail: string; payload: ActionPayload }
  | { ok: false; error: string };

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

const KIND: Record<ActionPayload["tool"], string> = {
  adjust_daily_budget: "budget",
  pause_ad: "pause",
  resume_ad: "creative",
  set_placements: "audience",
  generate_video: "creative",
  new_hook_variant: "creative",
  generate_image: "creative",
  generate_carousel: "creative",
  launch_creative: "creative",
  write_copy_variants: "creative",
  hold: "other",
};

function validateBrief(brief: CreativeBrief) {
  if (!brief.hook_line || !brief.hook_shot || !brief.primary_text || !brief.headline) return "Every brief field is required.";
  if (brief.body_shots.length < 1 || brief.body_shots.length > 3) return "Use 1 to 3 body shots.";
  if (brief.body_shots.some((s) => !s.prompt || !Number.isInteger(s.duration) || s.duration < 2 || s.duration > 6))
    return "Each body shot needs a prompt and a whole-number duration of 2 to 6 seconds.";
  const total = HOOK_SECONDS + brief.body_shots.reduce((s, b) => s + b.duration, 0);
  if (total > MAX_VIDEO_SECONDS) return `The video would be ${total}s; keep it to ${MAX_VIDEO_SECONDS}s including the ${HOOK_SECONDS}s hook.`;
  return checkCopy(brief.hook_line, brief.primary_text, brief.headline);
}

/** Validates one tool call against the current state. Also used to re-check proposals at approval time. */
export function evaluate(name: string, raw: unknown, ctx: EvalContext): Evaluated {
  const input = (raw ?? {}) as Record<string, unknown>;
  const title = str(input.title, 90);
  const detail = str(input.reason, 500);
  if (!title || !detail) return { ok: false, error: "Every action needs a title and a reason." };

  if (name !== "hold") {
    const limit = checkActionBudget(ctx);
    if (limit) return { ok: false, error: limit };
  }

  const done = (payload: ActionPayload, kind = KIND[payload.tool]): Evaluated => ({ ok: true, kind, title, detail, payload });
  const fail = (error: string): Evaluated => ({ ok: false, error });

  switch (name) {
    case "adjust_daily_budget": {
      const adsetId = str(input.adset_id, 40);
      const cents = Math.round(Number(input.daily_budget_usd) * 100);
      const err = checkBudgetChange(ctx, adsetId, cents);
      return err ? fail(err) : done({ tool: "adjust_daily_budget", adset_id: adsetId, cents });
    }
    case "pause_ad":
    case "resume_ad": {
      const adId = str(input.ad_id, 40);
      const err = name === "pause_ad" ? checkPauseAd(ctx, adId) : checkResumeAd(ctx, adId);
      return err ? fail(err) : done({ tool: name, ad_id: adId });
    }
    case "set_placements": {
      const adsetId = str(input.adset_id, 40);
      const placements = (Array.isArray(input.placements) ? input.placements : []).filter((p): p is Placement =>
        PLACEMENTS.includes(p as Placement),
      );
      const err = checkPlacements(ctx, adsetId);
      return err ? fail(err) : done({ tool: "set_placements", adset_id: adsetId, placements: [...new Set(placements)] });
    }
    case "generate_video": {
      const gen = checkGeneration(ctx, "video");
      if (gen) return fail(gen);
      const brief: CreativeBrief = {
        concept: str(input.concept, 200),
        ...(isTopic(input.topic) ? { topic: input.topic } : {}),
        style: str(input.style, 300),
        hook_line: str(input.hook_line, 200),
        hook_shot: str(input.hook_shot, 500),
        body_shots: (Array.isArray(input.body_shots) ? input.body_shots : []).map((s: { prompt?: unknown; duration?: unknown }) => ({
          prompt: str(s?.prompt, 500),
          duration: Number(s?.duration),
        })),
        primary_text: str(input.primary_text, 500),
        headline: str(input.headline, 60),
      };
      const err = validateBrief(brief);
      if (err) return fail(err);
      const launchId = typeof input.launch_adset_id === "string" && input.launch_adset_id ? input.launch_adset_id : null;
      if (launchId) {
        const target = checkLaunchTarget(ctx, launchId);
        if (target) return fail(target);
      }
      return done({ tool: "generate_video", brief, launch_adset_id: launchId, parent_creative_id: null });
    }
    case "generate_image": {
      const gen = checkGeneration(ctx);
      if (gen) return fail(gen);
      const lines = (Array.isArray(input.overlay_lines) ? input.overlay_lines : [])
        .map((l) => str(l, 200))
        .filter(Boolean);
      const button = typeof input.button_text === "string" ? str(input.button_text, 200) || null : null;
      const brief: ImageBrief = {
        format: "image",
        concept: str(input.concept, 200),
        ...(isTopic(input.topic) ? { topic: input.topic } : {}),
        scene: str(input.scene, 1000),
        style: str(input.style, 300),
        overlay_lines: lines,
        button_text: button,
        aspect_ratio: input.aspect_ratio === "9:16" ? "9:16" : "4:5",
        primary_text: str(input.primary_text, 500),
        headline: str(input.headline, 60),
      };
      if (!brief.scene || !brief.style || !brief.primary_text || !brief.headline)
        return fail("An image needs a scene, a style, primary text and a headline.");
      if (!textOnImage(brief)) {
        if (lines.length || button)
          return fail("9:16 Stories/Reels images are photos made without text. Leave overlay_lines empty and button_text null, and put the message in the primary text and headline.");
      } else if (lines.length < 1 || lines.length > MAX_OVERLAY_LINES)
        return fail(`Use 1 to ${MAX_OVERLAY_LINES} lines of text on the image.`);
      const long = lines.find((l) => l.length > MAX_OVERLAY_LINE_CHARS);
      if (long) return fail(`"${long}" is too long for the image; keep each line under ${MAX_OVERLAY_LINE_CHARS} characters.`);
      if (button && button.length > MAX_BUTTON_CHARS)
        return fail(`The button text is too long; keep it under ${MAX_BUTTON_CHARS} characters.`);
      const copy = checkCopy(...lines, button, brief.primary_text, brief.headline);
      if (copy) return fail(copy);
      const launchId = typeof input.launch_adset_id === "string" && input.launch_adset_id ? input.launch_adset_id : null;
      if (launchId) {
        const target = checkLaunchTarget(ctx, launchId);
        if (target) return fail(target);
      }
      return done({ tool: "generate_image", brief, launch_adset_id: launchId, parent_creative_id: null });
    }
    case "generate_carousel": {
      const gen = checkGeneration(ctx, "image");
      if (gen) return fail(gen);
      const rawCards = Array.isArray(input.cards) ? input.cards : [];
      if (rawCards.length !== CAROUSEL_CARDS) return fail(`A carousel has exactly ${CAROUSEL_CARDS} cards.`);
      const cards = rawCards.map((c: { scene?: unknown; overlay_lines?: unknown; headline?: unknown }) => ({
        scene: str(c?.scene, 1000),
        overlay_lines: (Array.isArray(c?.overlay_lines) ? c.overlay_lines : []).map((l) => str(l, 200)).filter(Boolean),
        headline: str(c?.headline, 60),
      }));
      const brief: CarouselBrief = {
        format: "carousel",
        concept: str(input.concept, 200),
        ...(isTopic(input.topic) ? { topic: input.topic } : {}),
        style: str(input.style, 300),
        cards,
        primary_text: str(input.primary_text, 500),
        headline: cards[0].headline,
      };
      if (!brief.style || !brief.primary_text) return fail("A carousel needs a style and primary text.");
      for (const [i, c] of cards.entries()) {
        if (!c.scene || !c.headline) return fail(`Card ${i + 1} needs a scene and a headline.`);
        if (c.overlay_lines.length < 1 || c.overlay_lines.length > MAX_CARD_LINES) return fail(`Card ${i + 1}: use 1 to ${MAX_CARD_LINES} lines of text.`);
        const long = c.overlay_lines.find((l) => l.length > MAX_OVERLAY_LINE_CHARS);
        if (long) return fail(`"${long}" is too long for a card; keep each line under ${MAX_OVERLAY_LINE_CHARS} characters.`);
        if (c.headline.length > 40) return fail(`Card ${i + 1}'s headline is too long; keep it under 40 characters.`);
      }
      const copy = checkCopy(...cards.flatMap((c) => [...c.overlay_lines, c.headline]), brief.primary_text);
      if (copy) return fail(copy);
      const launchId = str(input.launch_adset_id, 40);
      if (!launchId) return fail("Carousels launch straight into an ad set; give launch_adset_id.");
      const target = checkLaunchTarget(ctx, launchId);
      if (target) return fail(target);
      return done({ tool: "generate_carousel", brief, launch_adset_id: launchId, parent_creative_id: null });
    }
    case "new_hook_variant": {
      const gen = checkGeneration(ctx, "video");
      if (gen) return fail(gen);
      const source = ctx.scriptedAds.get(str(input.source_ad_id, 40));
      if (!source) return fail("That ad has no Migz video brief to reuse; use generate_video instead.");
      const brief: CreativeBrief = {
        ...source.script,
        hook_line: str(input.hook_line, 200),
        hook_shot: str(input.hook_shot, 500),
        primary_text: str(input.primary_text, 500),
      };
      const err = validateBrief(brief) ?? checkLaunchTarget(ctx, source.meta_adset_id);
      if (err) return fail(err);
      return done({ tool: "new_hook_variant", brief, launch_adset_id: source.meta_adset_id, parent_creative_id: source.creative_id });
    }
    case "launch_creative": {
      const creativeId = str(input.creative_id, 40);
      const adsetId = str(input.adset_id, 40);
      const primaryText = str(input.primary_text, 500);
      const headline = str(input.headline, 60);
      if (!ctx.libraryCreativeIds.has(creativeId)) return fail("That creative isn't in creatives_not_running.");
      if (!primaryText || !headline) return fail("Launching needs primary text and a headline.");
      const err = checkLaunchTarget(ctx, adsetId) ?? checkCopy(primaryText, headline);
      return err ? fail(err) : done({ tool: "launch_creative", creative_id: creativeId, adset_id: adsetId, primary_text: primaryText, headline });
    }
    case "write_copy_variants": {
      const sourceId = str(input.source_ad_id, 40);
      const adsetId = ctx.reusableAds?.get(sourceId);
      if (!adsetId) return fail("That ad's creative can't be reused (no uploaded Meta media); pick a live ad Migz launched.");
      const variants = (Array.isArray(input.variants) ? input.variants : [])
        .map((v: { primary_text?: unknown; headline?: unknown }) => ({ primary_text: str(v?.primary_text, 500), headline: str(v?.headline, 60) }))
        .filter((v) => v.primary_text && v.headline);
      if (variants.length < 1 || variants.length > MAX_COPY_VARIANTS) return fail(`Give 1 to ${MAX_COPY_VARIANTS} variants, each with primary text and a headline.`);
      const err = checkLaunchTarget(ctx, adsetId) ?? checkCopy(...variants.flatMap((v) => [v.primary_text, v.headline]));
      return err ? fail(err) : done({ tool: "write_copy_variants", source_ad_id: sourceId, adset_id: adsetId, variants });
    }
    case "hold": {
      const kind = ["budget", "creative", "audience", "other"].includes(String(input.kind)) ? String(input.kind) : "other";
      return done({ tool: "hold" }, kind);
    }
    default:
      return fail(`Unknown tool ${name}.`);
  }
}

/** Re-checks a stored proposal against fresh state at approval time (things may have moved on). */
export function recheck(payload: ActionPayload, ctx: EvalContext): string | null {
  switch (payload.tool) {
    case "adjust_daily_budget":
      return checkBudgetChange(ctx, payload.adset_id, payload.cents);
    case "pause_ad":
      return checkPauseAd(ctx, payload.ad_id);
    case "resume_ad":
      return checkResumeAd(ctx, payload.ad_id);
    case "set_placements":
      return checkPlacements(ctx, payload.adset_id);
    case "generate_video":
    case "generate_image":
    case "generate_carousel":
    case "new_hook_variant":
      return checkGeneration(ctx, payload.tool === "generate_image" || payload.tool === "generate_carousel" ? "image" : "video") ?? (payload.launch_adset_id ? checkLaunchTarget(ctx, payload.launch_adset_id) : null);
    case "launch_creative":
      return ctx.libraryCreativeIds.has(payload.creative_id)
        ? checkLaunchTarget(ctx, payload.adset_id)
        : "That creative is no longer waiting to launch.";
    case "write_copy_variants":
      return ctx.reusableAds?.has(payload.source_ad_id) ? checkLaunchTarget(ctx, payload.adset_id) : "That ad can no longer be reused.";
    case "hold":
      return null;
  }
}

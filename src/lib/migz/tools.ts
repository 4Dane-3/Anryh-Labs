import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { PLACEMENTS, type Placement } from "@/lib/meta/ads";
import {
  CAROUSEL_CARDS,
  briefDuration,
  hookSeconds,
  MAX_BODY_SHOTS,
  MIN_BODY_SHOTS,
  OPENING_SECONDS,
  OPENING_SHOTS,
  withOpeningPace,
  MAX_VOICEOVER_WORDS,
  timeJumpWithoutAging,
  MAX_BUTTON_CHARS,
  MAX_CARD_LINES,
  MAX_OVERLAY_LINE_CHARS,
  MAX_OVERLAY_LINES,
  MAX_VIDEO_SECONDS,
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
  checkPromoteAd,
  checkRestructure,
  checkQuoteMode,
  checkOptimizationEvent,
  promotionTarget,
  variantTarget,
  checkPauseAd,
  MAX_COPY_VARIANTS,
  checkPlacements,
  checkResumeAd,
  type GuardContext,
} from "@/lib/migz/guardrails";
import { isTopic, TOPIC_KEYS } from "@/lib/migz/topics";
import { QUOTE_MODES, type QuoteMode } from "@/lib/booking/constants";

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
    prompt: { type: "string", description: "What the camera sees in this shot: the same people doing one clear, natural action, the place and the light. E.g. 'Her two young kids run into the same sunlit kitchen in pajamas; she wipes her eyes, smiles and pulls them into a tight hug while breakfast cooks.'" },
    duration: { type: "number", description: `Seconds, 1 to 6. Ignored for the first ${MIN_BODY_SHOTS} body shots, which are fixed (see the tool's description); needed for any shot after them.` },
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
  tool("set_placements", "Set where an ad set's ads appear. An empty list means automatic placements within Facebook and Instagram (never the Audience Network or Messenger), usually the best default. Not allowed while learning. Keeping only Facebook or only Instagram needs that platform to book calls clearly cheaper (see results_by_platform_last_14_days); the system checks.", {
    adset_id: { type: "string" },
    placements: { type: "array", items: { type: "string", enum: PLACEMENTS } },
  }),
  tool(
    "generate_video",
    `Have Higgsfield make a new 9:16 video ad, written as a short film that opens with fast cuts: the hook shot and the next ${MIN_BODY_SHOTS} body shots run ${OPENING_SHOTS.join(", ")} seconds (${OPENING_SECONDS}s, fixed by the system: write ${MIN_BODY_SHOTS + 1} quick, distinct moments), then 1 or 2 more shots to finish, of any length from 1 to 6 seconds (total ${MAX_VIDEO_SECONDS}s max, so at most ${MAX_VIDEO_SECONDS - OPENING_SECONDS}s after the opening). Make the last shot at least 3 seconds: a calm pull-back, because the agent's logo end card plays over it. Tell one small story with an emotional arc, the same people in the same place throughout, and one clear, specific action per shot (who, what they hold or do, where, the light). E.g. a woman in her late 30s at a kitchen table at dawn holding a man's wristwatch, eyes wet, looks up at small footsteps; her two kids run in and she pulls them into a hug; years later her daughter in a graduation gown hugs her on the same porch; she straightens a family photo on the mantel and smiles. Never a specific real person or the agent; never talking to camera. Use for new angles, or when the agent has no creatives.`,
    {
      concept: { type: "string", description: "The angle in one line, e.g. 'Mortgage protection for new homeowners'." },
      topic: {
        type: "string",
        enum: [...TOPIC_KEYS, "other"],
        description: "The advertising topic this creative serves. Use the agent's ad focus unless there's a clear reason not to.",
      },
      style: { type: "string", description: "The look for every shot, e.g. 'warm natural light, soft film grain, handheld documentary style, muted earthy colors'." },
      cast: { type: "string", description: "The same people in every shot, with ages and a detail or two so they stay consistent, e.g. 'a woman in her late 30s with shoulder-length brown hair; her son about 6 and daughter about 9'. 1 to 3 people per shot." },
      setting: { type: "string", description: "One real place the story stays in, e.g. 'a real suburban home: sunlit kitchen, front porch, living room mantel'." },
      mood: { type: "string", description: "The emotional arc and what must never appear, e.g. 'grief turning into gratitude and relief; hopeful, never dark; no funerals, hospitals or caskets'." },
      narrator: {
        type: "string",
        enum: ["female", "male"],
        description: "Whose voice reads the voiceover: a powerful, commanding woman's voice, or a deep, serious man's voice. Pick what suits the story (often the opposite of the person the story centres on, so it sounds like someone telling their story).",
      },
      voiceover: {
        type: "string",
        description: `Required: narration by an off-screen narrator over the footage (nobody on screen talks), up to ${MAX_VOICEOVER_WORDS} words that tell the story and end on the call to action, e.g. 'She never had to choose between the house and the kids' future. He made sure of that. A free call can help you plan for yours.'`,
      },
      hook_line: { type: "string", description: "The opening idea in words; it also starts the primary text." },
      hook_shot: { type: "string", description: `Shot 1, the first ${OPENING_SHOTS[0]} seconds: a close, specific moment that stops the scroll (who, what they're holding or doing, the light). E.g. 'Close-up at dawn: the woman sits alone at the kitchen table holding a man's wristwatch, eyes wet; she hears small footsteps and looks toward the hallway.'` },
      body_shots: { type: "array", items: shotSchema, description: `${MIN_BODY_SHOTS + 1} to ${MAX_BODY_SHOTS} shots: the first ${MIN_BODY_SHOTS} are the quick opening cuts (${OPENING_SHOTS.slice(1).join(", ")} seconds), then one or two to finish.` },
      primary_text: { type: "string", description: "Ad copy above the video, starting with the hook line. Under 300 characters." },
      headline: { type: "string", description: "Short headline under the video, under 40 characters." },
      launch_adset_id: {
        type: ["string", "null"],
        description: "Ad set to launch it into once ready, or null to keep it in the creative library.",
      },
    },
    // Not strict: this is the largest schema, and strict tools share one grammar with a size limit.
    // evaluate() checks every field of every call anyway.
    false,
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
    `Have Higgsfield make a still image ad: a candid lifestyle photo with 1 to ${MAX_OVERLAY_LINES} short lines of text laid out above the people (every image carries its message on it, a hook or a phrase), plus an optional button-shaped label; the text layout and spelling instructions are added for you. 4:5 for Facebook and Instagram feeds, 9:16 for Stories and Reels. Cheaper and faster than video, so it's a good way to test a message; run images alongside videos rather than instead of them.`,
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
        description: `1 to ${MAX_OVERLAY_LINES} short lines shown on the image (required for every image), each under ${MAX_OVERLAY_LINE_CHARS} characters, read top to bottom. E.g. ["Prepare for the worst.", "Protect their peace.", "Get life insurance."].`,
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
    `Test new primary text and headline on an existing creative: creates up to ${MAX_COPY_VARIANTS} new ads reusing the source ad's video or image, in the same ad set (or in the exploration ad set when the source runs in the main one). Use when people watch but don't click.`,
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
  tool("promote_ad", "Move a proven ad from the exploration campaign into the main campaign: it's copied into the main ad set (same creative and copy) and paused in exploration, freeing room for the next test. Needs 1,000+ impressions in exploration, under 5 live ads in the main ad set (pause its weakest first), and the main ad set left alone for 3 days. Each promotion restarts the main ad set's learning, so promote only clear winners, together in one review.", {
    ad_id: { type: "string", description: "The exploration ad to promote." },
  }),
  tool("restructure", "Fold an account that's split across several campaigns or ad sets into one campaign with one ad set (plus the exploration campaign, if the batch has one), carrying the best live ads over. Use it when the strategist says the budget is split thinner than it can feed: every dollar then trains one ad set. It restarts learning once, so do it as soon as the split is found, not near a batch's end. Allowed during the results phase.", {}),
  tool(
    "set_quote_option",
    "Change how the agent's booking page shows \"Get a free quote\" (name and phone, the agent calls back): folded under the calendar (the default), open_for_ads (shown open to visitors who came from an ad, so the lighter step is the first thing they see), or off. Open it when ad visitors see the times but almost none book (the step is too big for cold traffic); fold it back if quote requests rise while bookings fall. Changes the page, not spend; allowed any time.",
    { mode: { type: "string", enum: [...QUOTE_MODES] } },
    false,
  ),
  tool(
    "set_optimization_event",
    "Change the conversion Meta optimizes an ad set for: LEAD (quote requests and booked calls both count) or SCHEDULE (booked calls only). Use LEAD while the account books under 10 calls a week, so Meta has enough events to learn from; switch to SCHEDULE once it books about 10 a week. Restarts the ad set's learning: do it once, early in a batch, together with other restarting changes. Allowed while results are being collected.",
    { adset_id: { type: "string" }, event: { type: "string", enum: ["LEAD", "SCHEDULE"] } },
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
  | { tool: "promote_ad"; ad_id: string; adset_id: string }
  | { tool: "restructure" }
  | { tool: "set_quote_option"; mode: QuoteMode }
  | { tool: "set_optimization_event"; adset_id: string; event: "LEAD" | "SCHEDULE" }
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
  promote_ad: "creative",
  restructure: "budget",
  set_quote_option: "other",
  set_optimization_event: "audience",
  hold: "other",
};

function validateBrief(brief: CreativeBrief) {
  if (!brief.hook_line || !brief.hook_shot || !brief.primary_text || !brief.headline) return "Every brief field is required.";
  if (brief.body_shots.length < 1 || brief.body_shots.length > MAX_BODY_SHOTS) return `Use 1 to ${MAX_BODY_SHOTS} body shots.`;
  if (brief.body_shots.some((s) => !s.prompt || !Number.isFinite(s.duration) || s.duration < 1 || s.duration > 6))
    return "Each body shot needs a prompt and a duration of 1 to 6 seconds.";
  const total = briefDuration(brief);
  if (total > MAX_VIDEO_SECONDS) return `The video would be ${total}s; keep it to ${MAX_VIDEO_SECONDS}s including the ${hookSeconds(brief)}s hook.`;
  return checkCopy(brief.hook_line, brief.primary_text, brief.headline, brief.voiceover);
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
      const err = checkPlacements(ctx, adsetId, placements);
      return err ? fail(err) : done({ tool: "set_placements", adset_id: adsetId, placements: [...new Set(placements)] });
    }
    case "generate_video": {
      const gen = checkGeneration(ctx, "video");
      if (gen) return fail(gen);
      const drafted: CreativeBrief = {
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
        cast: str(input.cast, 300),
        setting: str(input.setting, 300),
        mood: str(input.mood, 300),
      };
      // New videos open with fast cuts: the first shots' lengths are fixed (the model's own are ignored)
      if (drafted.body_shots.length < MIN_BODY_SHOTS)
        return fail(`A video opens with ${MIN_BODY_SHOTS + 1} quick shots (the hook shot and ${MIN_BODY_SHOTS} body shots, ${OPENING_SHOTS.join(", ")} seconds), then 1 or 2 more to finish. Give at least ${MIN_BODY_SHOTS} body shots.`);
      drafted.body_shots = drafted.body_shots.map((s, i) => (i < MIN_BODY_SHOTS ? { ...s, duration: OPENING_SHOTS[i + 1] } : s));
      const brief = withOpeningPace(drafted);
      // The short-film standard: the same people in one place, with a stated mood (see videoPrompt)
      if (!brief.cast || !brief.setting || !brief.mood)
        return fail("A video needs a cast (the same people in every shot), a setting (one real place) and a mood (the emotional arc and what never appears).");
      // Every new video is narrated: an off-screen voice over the footage (videoPrompt keeps everyone on screen silent)
      const voiceover = typeof input.voiceover === "string" ? str(input.voiceover, 400) : "";
      if (!voiceover) return fail("Every video needs a voiceover: a few warm, plain sentences from an off-screen narrator that tell the story and end on the call to action.");
      const words = voiceover.split(/\s+/).filter(Boolean).length;
      if (words > MAX_VOICEOVER_WORDS) return fail(`The voiceover is ${words} words; keep it to ${MAX_VOICEOVER_WORDS} so it fits 15 seconds without rushing.`);
      brief.voiceover = voiceover;
      brief.narrator = input.narrator === "male" ? "male" : "female";
      // Continuity: a time jump has to say how the people aged, or the model shows a grown tree next to an unchanged family
      const shots = [brief.hook_shot, ...brief.body_shots.map((b) => b.prompt)];
      const jumpAt = shots.findIndex(timeJumpWithoutAging);
      if (jumpAt >= 0)
        return fail(`Shot ${jumpAt + 1} jumps forward in time but doesn't say how the people have aged. Either keep the story in one stretch of time, or say it plainly (e.g. "Years later, the daughter is a teenager in a graduation gown and her mother has grey in her hair").`);
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
      if (lines.length < 1 || lines.length > MAX_OVERLAY_LINES)
        return fail(`Every image carries its message: use 1 to ${MAX_OVERLAY_LINES} lines of text on it (a hook or a short phrase).`);
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
      const target = variantTarget(ctx, source.meta_adset_id);
      const err = validateBrief(brief) ?? checkLaunchTarget(ctx, target);
      if (err) return fail(err);
      return done({ tool: "new_hook_variant", brief, launch_adset_id: target, parent_creative_id: source.creative_id });
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
      const sourceAdset = ctx.reusableAds?.get(sourceId);
      if (!sourceAdset) return fail("That ad's creative can't be reused (no uploaded Meta media); pick a live ad Migz launched.");
      const adsetId = variantTarget(ctx, sourceAdset);
      const variants = (Array.isArray(input.variants) ? input.variants : [])
        .map((v: { primary_text?: unknown; headline?: unknown }) => ({ primary_text: str(v?.primary_text, 500), headline: str(v?.headline, 60) }))
        .filter((v) => v.primary_text && v.headline);
      if (variants.length < 1 || variants.length > MAX_COPY_VARIANTS) return fail(`Give 1 to ${MAX_COPY_VARIANTS} variants, each with primary text and a headline.`);
      const err = checkLaunchTarget(ctx, adsetId) ?? checkCopy(...variants.flatMap((v) => [v.primary_text, v.headline]));
      return err ? fail(err) : done({ tool: "write_copy_variants", source_ad_id: sourceId, adset_id: adsetId, variants });
    }
    case "promote_ad": {
      const adId = str(input.ad_id, 40);
      const err = checkPromoteAd(ctx, adId);
      return err ? fail(err) : done({ tool: "promote_ad", ad_id: adId, adset_id: promotionTarget(ctx)! });
    }
    case "restructure": {
      const err = checkRestructure(ctx);
      return err ? fail(err) : done({ tool: "restructure" });
    }
    case "set_quote_option": {
      const mode = str(input.mode, 20);
      const err = checkQuoteMode(ctx, mode);
      return err ? fail(err) : done({ tool: "set_quote_option", mode: mode as QuoteMode });
    }
    case "set_optimization_event": {
      const adsetId = str(input.adset_id, 40);
      const event = str(input.event, 20);
      const err = checkOptimizationEvent(ctx, adsetId, event);
      return err ? fail(err) : done({ tool: "set_optimization_event", adset_id: adsetId, event: event as "LEAD" | "SCHEDULE" });
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
      return checkPlacements(ctx, payload.adset_id, payload.placements);
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
    case "promote_ad":
      return checkPromoteAd(ctx, payload.ad_id) ?? (promotionTarget(ctx) === payload.adset_id ? null : "The main ad set changed since this was proposed.");
    case "restructure":
      return checkRestructure(ctx);
    case "set_quote_option":
      return checkQuoteMode(ctx, payload.mode);
    case "set_optimization_event":
      return checkOptimizationEvent(ctx, payload.adset_id, payload.event);
    case "hold":
      return null;
  }
}

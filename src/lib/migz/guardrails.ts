import { checkPlatformFocus, type PlatformStats } from "@/lib/migz/platforms";
import { adsForBudget, SCHEDULE_FROM_CALLS_PER_WEEK } from "@/lib/migz/playbook";
import { QUOTE_MODES, type QuoteMode } from "@/lib/booking/constants";
import { isCostlyLoser, LIVE_ADS_HIGH, loserCheck, pauseWindow, WAVE_MAX, waveRoom } from "@/lib/migz/cycle";

// Hard limits on what Migz may do, enforced in code on every action (the model is told about them,
// but never trusted to follow them). Pure functions so they can be unit-tested.
// Each check returns null when allowed, or a reason the model can read and adapt to.

export const MAX_ACTIONS_PER_RUN = 6;
export const MAX_GENERATIONS_PER_RUN = 3;
export const MAX_VIDEOS_PER_RUN = 1; // videos are the expensive ones; images (4:5 feed, 9:16 story) fill the rest
// While a campaign is being set up, every creative launches at the start, so reviews make more at a time
export const MAX_GENERATIONS_PER_SETUP_RUN = 5;
export const MAX_VIDEOS_PER_SETUP_RUN = 2;
export const MAX_OPEN_GENERATIONS = 6;
export const MIN_ADSET_BUDGET_CENTS = 500;
export const MAX_BUDGET_CHANGE = 0.3; // per action; bigger jumps destabilise delivery
export const LEARNING_COOLDOWN_DAYS = 3; // after a significant edit, give Meta time to re-learn
export const MIN_IMPRESSIONS_TO_JUDGE = 1000;
export const MIN_SPEND_CENTS_TO_JUDGE = 1500;
const SAME_SITTING_HOURS = 2; // promotions made together (e.g. approving one review's proposals) count as one restart

export type AdState = {
  meta_ad_id: string;
  status: string;
  impressions: number; // last 14 days
  spend_cents: number; // last 14 days
  thruplays?: number; // last 14 days
  creative_id?: string | null;
  /** Booked calls (and instant-form leads) it brought in the last 14 days. */
  results?: number;
};

export type AdSetState = {
  meta_adset_id: string;
  status: string;
  daily_budget_cents: number;
  learning_status: string | null;
  last_edited_at: string;
  /** "explore" for the exploration campaign's ad set (new creative is tested there first). */
  role?: "main" | "explore";
  /** Facebook vs Instagram, last 14 days (for focusing an ad set on one platform). */
  platforms?: PlatformStats;
  /** The conversion Meta optimizes this ad set for (ad sets made before leads existed optimize for SCHEDULE). */
  optimization_event?: "SCHEDULE" | "LEAD";
  /** Where its ads send people: the booking page, or an instant form on Meta (low–medium intent). */
  destination?: "website" | "instant_form";
  ads: AdState[];
};

export type GuardContext = {
  now: Date;
  dailyCapCents: number;
  adsets: AdSetState[];
  actionsThisRun: number;
  generationsThisRun: number;
  videosThisRun?: number;
  /**
   * Campaign setup: the ad sets still short of their creative mix (campaign-plan creativeMix). New creatives
   * may only launch into these, and more are allowed per review (every creative launches at the start).
   */
  fillAdsets?: string[];
  /** What the agent's answers allow the copy to claim (null before they answered the start flow). */
  facts?: { noExam: boolean; healthIssuesOk: boolean } | null;
  /** The longest video this agent's video quality allows (15s, or 30s on Seedance 30s). */
  maxVideoSeconds?: number;
  /** Fewer new creatives than usual this review (e.g. 1 while checking whether generator credits are back; 0 outside batch setup). */
  maxGenerations?: number;
  /** Start of the revision phase (campaign start + 7 days). Before it, no pauses, budget or placement edits. */
  revisionsFrom?: Date | null;
  /** Day of the run (1 = the day it started, counting on through renewals), and whether it runs the creative cycle. */
  cycle?: { day: number; cycling: boolean } | null;
  /** Each ad set's target cost per result (booked call, or form lead), for the clear-loser rule. */
  targetCostCents?: Record<string, number>;
  /**
   * This review adds the two-weekly creative wave: new creatives go into these ad sets (up to LIVE_ADS_HIGH live
   * ads each), and budget, placement and optimization changes wait for another day. `launched` counts this review's;
   * `videoCents` is what one wave video costs the agent (0 on a free tier), and a paid one is always proposed first.
   */
  wave?: { day: number; adsets: string[]; launched: Record<string, number>; videoCents: number } | null;
  /** More actions than MAX_ACTIONS_PER_RUN (a wave into several ad sets). */
  maxActions?: number;
  /** Why no creatives are made in this review, and when the next wave is (shown when a generate tool is refused). */
  noCreativesWhy?: string;
  /** MIGZ_TEST_MODE: ads are built paused, so launching into a paused ad set is allowed. */
  testMode?: boolean;
  openGenerations: number;
  /** Days left in the running batch (null when there's no batch, or it has no end date). */
  batchDaysLeft?: number | null;
  /** How the booking page shows "Get a free quote" (agents.quote_mode). */
  quoteMode?: QuoteMode;
  /** Booked calls in the last 7 days, from any source. */
  bookedLast7?: number;
  /** The booking page funnel for visits from ads, last 14 days. */
  pageFunnel?: { visits: number; pickedTime: number; booked: number } | null;
};

const isActive = (status: string) => status === "ACTIVE";

function findAdSet(ctx: GuardContext, adsetId: string) {
  return ctx.adsets.find((a) => a.meta_adset_id === adsetId) ?? null;
}

function findAd(ctx: GuardContext, adId: string) {
  for (const adset of ctx.adsets) {
    const ad = adset.ads.find((a) => a.meta_ad_id === adId);
    if (ad) return { adset, ad };
  }
  return null;
}

export function checkActionBudget(ctx: GuardContext) {
  const max = ctx.maxActions ?? MAX_ACTIONS_PER_RUN;
  return ctx.actionsThisRun >= max ? `This review already has ${max} actions, the most allowed. Stop and summarize.` : null;
}

/** Learning phase per Meta, or a recent significant edit we made (which restarts learning). */
export function learningReason(adset: AdSetState, now: Date) {
  if (adset.learning_status?.toUpperCase() === "LEARNING") return "Meta reports it is in the learning phase";
  const days = (now.getTime() - new Date(adset.last_edited_at).getTime()) / 86_400_000;
  if (days < LEARNING_COOLDOWN_DAYS) return `it was last changed ${days < 1 ? "today" : `${Math.floor(days)} day(s) ago`}`;
  return null;
}

/** The plan the agent signed up for: the first 7 days collect results; revisions start after. */
export function revisionWait(ctx: GuardContext) {
  if (!ctx.revisionsFrom || ctx.now >= ctx.revisionsFrom) return null;
  const date = ctx.revisionsFrom.toISOString().slice(0, 10);
  return `The campaign is still collecting its first results; revisions (pausing ads, moving budget, changing placements) start on ${date}. Build and launch creative now, and hold everything else until then.`;
}

/** A wave review adds creatives only: budget, targeting and optimization changes wait for another day. */
export function waveHold(ctx: GuardContext) {
  return ctx.wave ? "This review adds the creative wave, and new ads go out on a day nothing else changes. Hold budget, placement and optimization changes for a later review." : null;
}

export function checkBudgetChange(ctx: GuardContext, adsetId: string, newCents: number) {
  const wait = revisionWait(ctx) ?? waveHold(ctx);
  if (wait) return wait;
  const adset = findAdSet(ctx, adsetId);
  if (!adset) return `No ad set ${adsetId} in this account.`;
  if (!isActive(adset.status)) return `Ad set ${adsetId} is ${adset.status}; budget changes only apply to active ad sets.`;
  const learning = learningReason(adset, ctx.now);
  if (learning) return `Ad set ${adsetId} shouldn't be edited yet: ${learning}. Changing its budget restarts learning; hold instead.`;
  if (!Number.isInteger(newCents) || newCents < MIN_ADSET_BUDGET_CENTS)
    return `Ad set budgets must be at least $${MIN_ADSET_BUDGET_CENTS / 100}/day.`;
  const change = Math.abs(newCents - adset.daily_budget_cents) / adset.daily_budget_cents;
  if (change > MAX_BUDGET_CHANGE)
    return `That is a ${Math.round(change * 100)}% change; keep each change within ${MAX_BUDGET_CHANGE * 100}% (between $${((adset.daily_budget_cents * (1 - MAX_BUDGET_CHANGE)) / 100).toFixed(2)} and $${((adset.daily_budget_cents * (1 + MAX_BUDGET_CHANGE)) / 100).toFixed(2)}).`;
  const otherActive = ctx.adsets
    .filter((a) => a.meta_adset_id !== adsetId && isActive(a.status))
    .reduce((s, a) => s + a.daily_budget_cents, 0);
  if (otherActive + newCents > ctx.dailyCapCents)
    return `That would put total daily spend at $${((otherActive + newCents) / 100).toFixed(2)}, over the agent's $${(ctx.dailyCapCents / 100).toFixed(2)}/day budget. The most this ad set can have is $${((ctx.dailyCapCents - otherActive) / 100).toFixed(2)}.`;
  return null;
}

/**
 * Pausing: only clear losers (LOSER_SPEND_MULTIPLE times the ad set's target cost with no result), only when the
 * cycle allows (not in the first week, not while a wave is being read), and never an ad set's last live ad.
 */
export function checkPauseAd(ctx: GuardContext, adId: string) {
  const found = findAd(ctx, adId);
  // A costly loser is losing real money, so it may go on any day: the first week and a wave's read don't hold it
  const costly = !!found && isCostlyLoser({ spend_cents: found.ad.spend_cents, results: found.ad.results ?? 0 }, ctx.targetCostCents?.[found.adset.meta_adset_id]);
  const wait = costly ? null : (revisionWait(ctx) ?? (ctx.cycle ? pauseWindow(ctx.cycle.day, ctx.cycle.cycling) : null));
  if (wait) return wait;
  if (!found) return `No ad ${adId} in this account.`;
  const { adset, ad } = found;
  if (!isActive(ad.status)) return `Ad ${adId} is already ${ad.status}.`;
  if (ad.impressions < MIN_IMPRESSIONS_TO_JUDGE && ad.spend_cents < MIN_SPEND_CENTS_TO_JUDGE)
    return `Ad ${adId} has only ${ad.impressions} impressions and $${(ad.spend_cents / 100).toFixed(2)} spend, too little to judge. Wait for at least ${MIN_IMPRESSIONS_TO_JUDGE} impressions or $${MIN_SPEND_CENTS_TO_JUDGE / 100}.`;
  const othersLive = adset.ads.filter((a) => a.meta_ad_id !== adId && isActive(a.status)).length;
  if (othersLive === 0)
    return `Ad ${adId} is the only live ad in its ad set; pausing it would stop delivery. Launch a replacement first.`;
  const loser = ctx.targetCostCents ? loserCheck({ spend_cents: ad.spend_cents, results: ad.results ?? 0 }, ctx.targetCostCents[adset.meta_adset_id]) : null;
  if (loser) return `Ad ${adId} isn't a clear loser yet: ${loser}`;
  return null;
}

export function checkResumeAd(ctx: GuardContext, adId: string) {
  const found = findAd(ctx, adId);
  if (!found) return `No ad ${adId} in this account.`;
  if (found.ad.status !== "PAUSED") return `Ad ${adId} is ${found.ad.status}, not paused.`;
  if (!isActive(found.adset.status)) return `Its ad set is ${found.adset.status}.`;
  return null;
}

export function checkPlacements(ctx: GuardContext, adsetId: string, placements: string[] = []) {
  const wait = revisionWait(ctx) ?? waveHold(ctx);
  if (wait) return wait;
  const adset = findAdSet(ctx, adsetId);
  if (!adset) return `No ad set ${adsetId} in this account.`;
  const learning = learningReason(adset, ctx.now);
  if (learning) return `Ad set ${adsetId} shouldn't be edited yet: ${learning}.`;
  // Dropping Facebook or Instagram entirely needs booked-call evidence (see platforms.ts)
  return checkPlatformFocus(adset.platforms, placements);
}

/** The live exploration ad set, when the plan has one. */
export const exploreAdSet = (ctx: GuardContext) => ctx.adsets.find((a) => a.role === "explore" && isActive(a.status)) ?? null;
const mainAdSet = (ctx: GuardContext) => ctx.adsets.find((a) => a.role !== "explore" && isActive(a.status)) ?? null;

/**
 * Where a variant of an existing ad launches: the exploration ad set when there is one and the source
 * runs in a main ad set (tests never restart the main one), else the source's own ad set.
 */
export function variantTarget(ctx: GuardContext, sourceAdsetId: string) {
  const explore = exploreAdSet(ctx);
  return explore && findAdSet(ctx, sourceAdsetId)?.role !== "explore" ? explore.meta_adset_id : sourceAdsetId;
}

export function checkLaunchTarget(ctx: GuardContext, adsetId: string) {
  const adset = findAdSet(ctx, adsetId);
  if (!adset) return `No ad set ${adsetId} in this account.`;
  if (!isActive(adset.status) && !(ctx.testMode && adset.status === "PAUSED")) return `Ad set ${adsetId} is ${adset.status}.`;
  // With an exploration campaign, new creative is tested there first; the main ad set only takes
  // promoted winners (or its first ads, when it has none live)
  const explore = exploreAdSet(ctx);
  if (explore && adset.role !== "explore" && adset.ads.some((a) => isActive(a.status)))
    return `New creative launches into the exploration ad set (${explore.meta_adset_id}) first, so the main ad set keeps learning. Promote it with promote_ad once it proves itself there.`;
  return null;
}

/**
 * Moving a proven exploration ad into the main ad set: it needs enough data to not be luck, room in
 * the main ad set, and the main ad set left alone for 3 days (each promotion restarts its learning, so
 * winners are promoted together rather than one by one).
 */
export const MIN_RESTRUCTURE_DAYS_LEFT = 4; // a rebuilt ad set needs a few days to learn before the batch ends

/** Restructure folds a split account into one campaign with one ad set (plus exploration, if the batch has it). */
export function checkRestructure(ctx: GuardContext) {
  const main = ctx.adsets.filter((s) => isActive(s.status) && s.role !== "explore");
  if (main.length <= 1) return "The account already runs one main ad set; there's nothing to fold together.";
  if (ctx.batchDaysLeft === undefined || ctx.batchDaysLeft === null) return "Restructuring rebuilds the running batch, and there isn't one with an end date.";
  if (ctx.batchDaysLeft < MIN_RESTRUCTURE_DAYS_LEFT)
    return `Only ${ctx.batchDaysLeft} day${ctx.batchDaysLeft === 1 ? "" : "s"} left in this batch: a rebuilt ad set wouldn't have time to learn. The next batch starts as one campaign anyway.`;
  return null;
}

const QUOTE_OPEN_BELOW = 0.05; // ad visitors booking under 5%: the step is too big for them

/**
 * The booking page's "Get a free quote": folded under the calendar (the default), open for visitors from
 * ads, or off. Opening it needs enough ad visitors who mostly don't book; turning it off needs bookings
 * coming in and an ad set that doesn't optimize for leads (quote requests are most of its leads).
 */
export function checkQuoteMode(ctx: GuardContext, mode: string) {
  if (!QUOTE_MODES.includes(mode as QuoteMode)) return `Mode must be one of ${QUOTE_MODES.join(", ")}.`;
  const current = ctx.quoteMode ?? "folded";
  if (mode === current) return `The quote option is already ${mode}.`;
  const f = ctx.pageFunnel;
  if (mode === "open_for_ads") {
    if (!f || f.visits < 20) return `Only ${f?.visits ?? 0} visits from ads in 14 days, too few to know the page needs a lighter step. Wait for 20.`;
    if (f.booked / f.visits >= QUOTE_OPEN_BELOW)
      return `${f.booked} of ${f.visits} ad visitors booked (${Math.round((f.booked / f.visits) * 100)}%): booking works, so keep the quote option folded and booking the main path.`;
  }
  if (mode === "off") {
    if (ctx.adsets.some((s) => isActive(s.status) && s.optimization_event === "LEAD"))
      return "An ad set optimizes for leads, and quote requests are most of them. Switch it to SCHEDULE first (set_optimization_event), or keep the quote option.";
    if (!f || f.booked < 3) return "Bookings from ads are still too few to drop the quote option; it's the step most ad visitors take. Fold it instead if it seems to take bookings away.";
  }
  return null;
}

/**
 * Which conversion an ad set optimizes for. LEAD (quote requests and bookings) while the account books
 * under SCHEDULE_FROM_CALLS_PER_WEEK calls a week, SCHEDULE from there. A switch restarts learning, so not
 * in a batch's last days or within 3 days of another change (changes made in one sitting count as one).
 * Allowed while results are being collected: optimizing for an event that never happens is spending blind.
 */
export function checkOptimizationEvent(ctx: GuardContext, adsetId: string, event: string) {
  if (event !== "LEAD" && event !== "SCHEDULE") return "Event must be LEAD or SCHEDULE.";
  const hold = waveHold(ctx);
  if (hold) return hold;
  const adset = findAdSet(ctx, adsetId);
  if (!adset) return `No ad set ${adsetId} in this account.`;
  if (!isActive(adset.status)) return `Ad set ${adsetId} is ${adset.status}.`;
  const current = adset.optimization_event ?? "SCHEDULE";
  if (current === event) return `Ad set ${adsetId} already optimizes for ${event}.`;
  if (ctx.batchDaysLeft === undefined || ctx.batchDaysLeft === null) return "There's no running batch with an end date; switch when the next batch starts.";
  if (ctx.batchDaysLeft < MIN_RESTRUCTURE_DAYS_LEFT)
    return `Only ${ctx.batchDaysLeft} day${ctx.batchDaysLeft === 1 ? "" : "s"} left in this batch: the ad set wouldn't have time to re-learn. Switch when the next batch starts.`;
  const booked = ctx.bookedLast7 ?? 0;
  if (event === "LEAD") {
    if (ctx.quoteMode === "off") return "The quote option is off, so a lead would only ever be a booking. Turn it back on (set_quote_option) first.";
    if (booked >= SCHEDULE_FROM_CALLS_PER_WEEK) return `${booked} booked calls in the last 7 days is enough for Meta to learn from bookings directly; keep SCHEDULE.`;
  } else if (booked < SCHEDULE_FROM_CALLS_PER_WEEK) {
    return `${booked} booked call${booked === 1 ? "" : "s"} in the last 7 days; Meta needs about ${SCHEDULE_FROM_CALLS_PER_WEEK} a week before optimizing for bookings beats optimizing for leads.`;
  }
  const hours = (ctx.now.getTime() - new Date(adset.last_edited_at).getTime()) / 3_600_000;
  if (hours >= SAME_SITTING_HOURS && hours < LEARNING_COOLDOWN_DAYS * 24)
    return `Ad set ${adsetId} changed ${hours < 24 ? "today" : `${Math.floor(hours / 24)} day(s) ago`}. Switching the event restarts learning again; wait until ${LEARNING_COOLDOWN_DAYS} days have passed.`;
  return null;
}

export function checkPromoteAd(ctx: GuardContext, adId: string) {
  const wait = revisionWait(ctx);
  if (wait) return wait;
  const found = findAd(ctx, adId);
  if (!found) return `No ad ${adId} in this account.`;
  if (found.adset.role !== "explore") return `Ad ${adId} isn't in the exploration campaign; only exploration ads are promoted.`;
  if (!isActive(found.ad.status)) return `Ad ${adId} is ${found.ad.status}.`;
  if (found.ad.impressions < MIN_IMPRESSIONS_TO_JUDGE)
    return `Ad ${adId} has ${found.ad.impressions} impressions in exploration. Promote it after ${MIN_IMPRESSIONS_TO_JUDGE}, so the result isn't luck.`;
  const main = mainAdSet(ctx);
  if (!main) return "There's no live main ad set to promote into.";
  const live = main.ads.filter((a) => isActive(a.status));
  if (found.ad.creative_id && live.some((a) => a.creative_id === found.ad.creative_id)) return "That creative already runs in the main ad set.";
  const room = adsForBudget(main.daily_budget_cents);
  if (live.length >= room) return `The main ad set already has ${live.length} live ads, as many as its $${(main.daily_budget_cents / 100).toFixed(2)}/day can give a fair read. Pause its weakest first, so the winner gets real spend.`;
  const hours = (ctx.now.getTime() - new Date(main.last_edited_at).getTime()) / 3_600_000;
  if (hours >= SAME_SITTING_HOURS && hours < LEARNING_COOLDOWN_DAYS * 24)
    return `The main ad set changed ${hours < 24 ? "today" : `${Math.floor(hours / 24)} day(s) ago`}. A promotion restarts its learning, so wait until ${LEARNING_COOLDOWN_DAYS} days have passed and promote the winners together.`;
  return null;
}

/** The main ad set a promoted ad goes into. */
export const promotionTarget = (ctx: GuardContext) => mainAdSet(ctx)?.meta_adset_id ?? null;

/**
 * Ads under this link CTR are a hint, not a pause trigger: the next creative wave (or the next campaign's setup)
 * builds on the angles that clear it.
 */
export const WEAK_CTR_BELOW = 0.025;

/** Live ads in an ad set, as the guardrails see it (paused ones too in test mode, where ads are built paused). */
const liveAds = (ctx: GuardContext, adset: AdSetState) => adset.ads.filter((a) => isActive(a.status) || (ctx.testMode && a.status === "PAUSED")).length;

/**
 * While a campaign is set up, new creatives go only into the ad sets still short of their mix. In a wave, only
 * into the wave's ad sets, up to LIVE_ADS_HIGH live ads each. Launched straight in either way.
 */
export function checkFillTarget(ctx: GuardContext, launchAdsetId: string | null) {
  if (ctx.wave) {
    const sets = ctx.wave.adsets;
    if (!launchAdsetId || !sets.includes(launchAdsetId))
      return `This review's creative wave goes into ad set${sets.length === 1 ? "" : "s"} ${sets.join(", ")} (see creative_wave). Launch each new creative straight into ${sets.length === 1 ? "it" : "one of them"}.`;
    const adset = findAdSet(ctx, launchAdsetId);
    if ((ctx.wave.launched[launchAdsetId] ?? 0) >= WAVE_MAX)
      return `Ad set ${launchAdsetId} has its ${WAVE_MAX} new creatives for this wave. Put the next one in another wave ad set, or stop.`;
    if (adset && waveRoom(liveAds(ctx, adset) + (ctx.wave.launched[launchAdsetId] ?? 0)) <= 0)
      return `Ad set ${launchAdsetId} already has ${LIVE_ADS_HIGH} live ads (with this wave). Pause its clear losers first, or put the creative in another wave ad set.`;
    return null;
  }
  if (!ctx.fillAdsets) return null;
  if (!launchAdsetId || !ctx.fillAdsets.includes(launchAdsetId))
    return `This campaign's setup still needs creatives in ad set${ctx.fillAdsets.length === 1 ? "" : "s"} ${ctx.fillAdsets.join(", ")} (see campaign_setup). Launch new creatives straight into ${ctx.fillAdsets.length === 1 ? "it" : "one of them"}.`;
  return null;
}

export function checkGeneration(ctx: GuardContext, kind: "image" | "video" = "image") {
  const setup = !!ctx.fillAdsets?.length;
  const cap = ctx.maxGenerations ?? (setup ? MAX_GENERATIONS_PER_SETUP_RUN : MAX_GENERATIONS_PER_RUN);
  // A wave may make one video per ad set it fills
  const videoCap = setup ? MAX_VIDEOS_PER_SETUP_RUN : ctx.wave ? Math.max(MAX_VIDEOS_PER_RUN, ctx.wave.adsets.length) : MAX_VIDEOS_PER_RUN;
  if (cap === 0)
    return `${ctx.noCreativesWhy ?? "New creatives are only made when a campaign is set up and in its two-weekly creative wave (or when no ads are live)."} This review studies the live ads and records what they teach with record_learning instead.`;
  if (ctx.generationsThisRun >= cap)
    return `Already started ${cap} creative${cap === 1 ? "" : "s"} this review, the most allowed${cap < MAX_GENERATIONS_PER_RUN ? " while the generator's credits are being checked" : " per review"}${setup ? "; the next review makes the rest of the setup" : ""}.`;
  if (kind === "video" && (ctx.videosThisRun ?? 0) >= videoCap)
    return `Already started ${videoCap} video${videoCap === 1 ? "" : "s"} this review, the most per review (videos cost the most). Make a 4:5 feed image or a 9:16 Stories/Reels image instead.`;
  if (ctx.openGenerations >= MAX_OPEN_GENERATIONS)
    return `${ctx.openGenerations} creatives are still being made; wait for those before starting more.`;
  return null;
}

// Life insurance ads run under Meta's Financial Products & Services category and state insurance
// advertising rules: no guarantees, no implied approval, no calling out personal attributes.
const COPY_RULES: [RegExp, string][] = [
  [/\bguarantee(d|s)?\b/i, "no guarantees (of approval, rates or savings)"],
  [/\b(pre-?)?approved\b/i, "don't imply anyone is approved"],
  [/\byou (qualify|are eligible)\b/i, "don't tell people they qualify"],
  [/\bfree (money|insurance|coverage)\b/i, "insurance isn't free"],
  [/\bare you (over|under|older than|younger than) \d+/i, "don't call out age (personal attribute)"],
  [/\b(are you|if you're) (a smoker|sick|ill|diabetic|overweight|in debt|divorced|widowed|single|pregnant)\b/i, "don't call out personal attributes"],
  [/\bdo you (smoke|have (cancer|diabetes|a health condition|health problems))\b/i, "don't call out health conditions"],
  [/\b(lowest|cheapest) (rates?|prices?|premiums?)\b/i, "no 'lowest/cheapest rate' claims"],
  [/\bno medical exam (for everyone|guaranteed)\b/i, "no blanket no-exam claims"],
  [/\b(government|state|federal) (program|benefit|plan)\b/i, "don't imply a government program"],
  // Age: a range or a condition is fine ("for people 50–85", "if you're between 50 and 85"); telling the
  // viewer their age or situation is not
  [/(?<!\bif )\byou(?:'re|’re| are) (?:\d{2}\b|over \d|under \d|in your \d0s|a senior|retired|still (?:uninsured|without))/i, "don't tell the viewer their age or situation; say who it's for ('for people 50–85') or use a condition ('if you're between 50 and 85')"],
  [/(?<!\bif )\byou (?:still )?(?:don't|don’t|do not|dont) have (?:any )?(?:life )?(?:insurance|coverage)\b/i, "don't tell the viewer their situation ('you still don't have coverage')"],
  [/\bat your age\b/i, "don't call out the viewer's age"],
];

/** "Are you over 60?" reads as calling out age when it's written on the ad; spoken, a condition is fine. */
const ON_SCREEN_RULES: [RegExp, string][] = [[/\bare you (?:\d{2}|over|under|between|older|younger|a senior)\b/i, "on-screen text can't ask the viewer's age; write who it's for ('for people 50–85', 'seniors 60+')"]];

export function checkOnScreen(...texts: (string | null | undefined)[]) {
  for (const t of texts) if (t) for (const [pattern, rule] of ON_SCREEN_RULES) if (pattern.test(t)) return `Ad copy breaks insurance ad rules: ${rule}. Rewrite it.`;
  return null;
}

/** Claims the agent's own answers don't back: "no exam" when they only write fully underwritten, health issues welcome when they don't take them. */
export function checkClaims(facts: GuardContext["facts"], ...texts: (string | null | undefined)[]) {
  if (!facts) return null;
  const all = texts.filter(Boolean).join("\n");
  if (!facts.noExam && /\b(no (?:medical )?exams?|without (?:a |an )?(?:medical )?exam|exam[- ]free|skip the exam)\b/i.test(all))
    return "This agent writes fully underwritten coverage (with a medical exam), so the ad can't promise no exam. Use another angle.";
  if (!facts.healthIssuesOk && /\b(no health questions|any health|health issues? (?:ok|welcome|accepted)|pre-?existing conditions? (?:ok|welcome|accepted))\b/i.test(all))
    return "This agent doesn't take people with health issues (guaranteed issue), so the ad can't say health issues are fine. Use another angle.";
  return null;
}

export function checkCopy(...texts: (string | null | undefined)[]) {
  const problems = new Set<string>();
  for (const text of texts) {
    if (!text) continue;
    for (const [pattern, rule] of COPY_RULES) if (pattern.test(text)) problems.add(rule);
  }
  return problems.size ? `Ad copy breaks insurance ad rules: ${[...problems].join("; ")}. Rewrite it.` : null;
}

// Market examples are inspiration only: refuse copy that lifts a run of 6+ words from the swipe file.
export const COPY_RUN_WORDS = 6;

const words = (t: string) => t.toLowerCase().replace(/[^a-z0-9' ]+/g, " ").split(/\s+/).filter(Boolean);

export function checkNotCopied(texts: (string | null | undefined)[], swipeTexts: string[]) {
  const runs = new Set<string>();
  for (const s of swipeTexts) {
    const w = words(s);
    for (let i = 0; i + COPY_RUN_WORDS <= w.length; i++) runs.add(w.slice(i, i + COPY_RUN_WORDS).join(" "));
  }
  if (!runs.size) return null;
  for (const t of texts) {
    if (!t) continue;
    const w = words(t);
    for (let i = 0; i + COPY_RUN_WORDS <= w.length; i++) {
      const run = w.slice(i, i + COPY_RUN_WORDS).join(" ");
      if (runs.has(run)) return `"${run}" is lifted from a market example. Swipe-file ads are inspiration only; write it in your own words.`;
    }
  }
  return null;
}

export const MAX_COPY_VARIANTS = 2;

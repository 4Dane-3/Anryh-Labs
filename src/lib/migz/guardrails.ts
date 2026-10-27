import { checkPlatformFocus, type PlatformStats } from "@/lib/migz/platforms";

// Hard limits on what Migz may do, enforced in code on every action (the model is told about them,
// but never trusted to follow them). Pure functions so they can be unit-tested.
// Each check returns null when allowed, or a reason the model can read and adapt to.

export const MAX_ACTIONS_PER_RUN = 6;
export const MAX_GENERATIONS_PER_RUN = 3;
export const MAX_VIDEOS_PER_RUN = 1; // videos are the expensive ones; images (4:5 feed, 9:16 story) fill the rest
export const MAX_OPEN_GENERATIONS = 6;
export const MIN_ADSET_BUDGET_CENTS = 500;
export const MAX_BUDGET_CHANGE = 0.3; // per action; bigger jumps destabilise delivery
export const LEARNING_COOLDOWN_DAYS = 3; // after a significant edit, give Meta time to re-learn
export const MIN_IMPRESSIONS_TO_JUDGE = 1000;
export const MIN_SPEND_CENTS_TO_JUDGE = 1500;
export const MAX_MAIN_ADS = 5; // live ads in a main ad set: more and each one gets too little spend to judge
const SAME_SITTING_HOURS = 2; // promotions made together (e.g. approving one review's proposals) count as one restart

export type AdState = {
  meta_ad_id: string;
  status: string;
  impressions: number; // last 14 days
  spend_cents: number; // last 14 days
  thruplays?: number; // last 14 days
  creative_id?: string | null;
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
  ads: AdState[];
};

export type GuardContext = {
  now: Date;
  dailyCapCents: number;
  adsets: AdSetState[];
  actionsThisRun: number;
  generationsThisRun: number;
  videosThisRun?: number;
  /** Fewer new creatives than usual this review (e.g. 1 while checking whether generator credits are back). */
  maxGenerations?: number;
  /** Start of the revision phase (campaign start + 7 days). Before it, no pauses, budget or placement edits. */
  revisionsFrom?: Date | null;
  /** MIGZ_TEST_MODE: ads are built paused, so launching into a paused ad set is allowed. */
  testMode?: boolean;
  openGenerations: number;
  /** Days left in the running batch (null when there's no batch, or it has no end date). */
  batchDaysLeft?: number | null;
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
  return ctx.actionsThisRun >= MAX_ACTIONS_PER_RUN
    ? `This review already has ${MAX_ACTIONS_PER_RUN} actions, the most allowed. Stop and summarize.`
    : null;
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
  return `The campaign is still collecting its first week of results; revisions (pausing ads, moving budget, changing placements) start on ${date}. Build and launch creative now, and hold everything else until then.`;
}

export function checkBudgetChange(ctx: GuardContext, adsetId: string, newCents: number) {
  const wait = revisionWait(ctx);
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

export function checkPauseAd(ctx: GuardContext, adId: string) {
  const wait = revisionWait(ctx);
  if (wait) return wait;
  const found = findAd(ctx, adId);
  if (!found) return `No ad ${adId} in this account.`;
  const { adset, ad } = found;
  if (!isActive(ad.status)) return `Ad ${adId} is already ${ad.status}.`;
  if (ad.impressions < MIN_IMPRESSIONS_TO_JUDGE && ad.spend_cents < MIN_SPEND_CENTS_TO_JUDGE)
    return `Ad ${adId} has only ${ad.impressions} impressions and $${(ad.spend_cents / 100).toFixed(2)} spend, too little to judge. Wait for at least ${MIN_IMPRESSIONS_TO_JUDGE} impressions or $${MIN_SPEND_CENTS_TO_JUDGE / 100}.`;
  const othersLive = adset.ads.filter((a) => a.meta_ad_id !== adId && isActive(a.status)).length;
  if (othersLive === 0)
    return `Ad ${adId} is the only live ad in its ad set; pausing it would stop delivery. Launch a replacement first.`;
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
  const wait = revisionWait(ctx);
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
  if (live.length >= MAX_MAIN_ADS) return `The main ad set already has ${live.length} live ads. Pause its weakest first, so the winner gets real spend.`;
  const hours = (ctx.now.getTime() - new Date(main.last_edited_at).getTime()) / 3_600_000;
  if (hours >= SAME_SITTING_HOURS && hours < LEARNING_COOLDOWN_DAYS * 24)
    return `The main ad set changed ${hours < 24 ? "today" : `${Math.floor(hours / 24)} day(s) ago`}. A promotion restarts its learning, so wait until ${LEARNING_COOLDOWN_DAYS} days have passed and promote the winners together.`;
  return null;
}

/** The main ad set a promoted ad goes into. */
export const promotionTarget = (ctx: GuardContext) => mainAdSet(ctx)?.meta_adset_id ?? null;

export function checkGeneration(ctx: GuardContext, kind: "image" | "video" = "image") {
  const cap = ctx.maxGenerations ?? MAX_GENERATIONS_PER_RUN;
  if (ctx.generationsThisRun >= cap)
    return `Already started ${cap} creative${cap === 1 ? "" : "s"} this review, the most allowed${cap < MAX_GENERATIONS_PER_RUN ? " while the generator's credits are being checked" : " per review"}.`;
  if (kind === "video" && (ctx.videosThisRun ?? 0) >= MAX_VIDEOS_PER_RUN)
    return `Already started ${MAX_VIDEOS_PER_RUN} video this review, the most per review (videos cost the most). Make a 4:5 feed image or a 9:16 Stories/Reels image instead.`;
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
];

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

// The checks every Google Ads change passes before it's made. Pure, so the tests cover it. A rejected change
// returns why, in words Migz can act on.

import { roofingCopyProblem } from "@/lib/verticals";
import {
  BIDDING_MIN_DAYS_BETWEEN,
  BUDGET_MAX_STEP,
  BUDGET_MIN_DAYS_BETWEEN,
  CORE_WORDS,
  dailyFromMonthly,
  DESCRIPTION_MAX,
  HEADLINE_MAX,
  KEYWORD_MAX,
  LEARNING_DAYS,
  MAX_ADS_PER_GROUP,
  MAX_DESCRIPTIONS,
  MAX_HEADLINES,
  MAX_KEYWORDS_PER_ACTION,
  MAX_NEGATIVES_PER_ACTION,
  MIN_DESCRIPTIONS,
  MIN_HEADLINES,
  PATH_MAX,
  PAUSE_MIN_CLICKS,
  PAUSE_MIN_SPEND_CENTS,
  PAUSE_MIN_SPEND_X_TARGET,
  TARGET_CPA_FLOOR,
  TARGET_CPA_MIN_CONVERSIONS,
  type MatchType,
} from "@/lib/google-ads/playbook";
import { cpaCents, type GoogleSnapshot } from "@/lib/google-ads/types";

export type Term = { text: string; match: MatchType };

export type GAction =
  | { tool: "add_negative_keywords"; terms: Term[] }
  | { tool: "add_keywords"; ad_group_id: string; keywords: Term[] }
  | { tool: "pause_keyword"; ad_group_id: string; criterion_id: string }
  | { tool: "resume_keyword"; ad_group_id: string; criterion_id: string }
  | { tool: "write_ad"; ad_group_id: string; headlines: string[]; descriptions: string[]; path1: string; path2: string }
  | { tool: "pause_ad"; ad_group_id: string; ad_id: string }
  | { tool: "set_daily_budget"; daily_cents: number }
  | { tool: "set_bidding"; strategy: "MAXIMIZE_CONVERSIONS" | "TARGET_CPA"; target_cpa_cents: number | null }
  | { tool: "hold" };

export type GuardCtx = {
  snapshot: GoogleSnapshot;
  campaignId: string | null;
  monthlyCapCents: number;
  launchedAt: string | null;
  lastBudgetChangeAt: string | null;
  lastBiddingChangeAt: string | null;
  now?: number;
};

const DAY = 86_400_000;
const daysSince = (iso: string | null, now: number) => (iso ? (now - Date.parse(iso)) / DAY : Infinity);
const usd = (c: number) => `$${(c / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;

/** A keyword as Google takes it: lowercase words, no symbols Google rejects. Empty when it isn't usable. */
export function cleanKeyword(text: string) {
  const t = text.toLowerCase().replace(/[“”"[\]+]/g, "").replace(/\s+/g, " ").trim();
  return t.length <= KEYWORD_MAX && /^[a-z0-9][a-z0-9 '&.\-/]*$/.test(t) && t.split(" ").length <= 10 ? t : "";
}

/** Whether a phrase (or exact) negative would block a search. */
export function blocks(negative: Term, search: string) {
  const s = ` ${search.toLowerCase().replace(/\s+/g, " ").trim()} `;
  const n = negative.text.toLowerCase().trim();
  if (negative.match === "EXACT") return s.trim() === n;
  if (negative.match === "PHRASE") return s.includes(` ${n} `);
  return n.split(" ").every((w) => s.includes(` ${w} `)); // broad negative: every word, any order
}

const campaignOf = (ctx: GuardCtx) => ctx.snapshot.campaigns.find((c) => c.id === ctx.campaignId) ?? ctx.snapshot.campaigns.find((c) => c.status === "ENABLED") ?? ctx.snapshot.campaigns[0] ?? null;

/** The target cost per booked inspection the review works to: the campaign's target, else the 30-day actual. */
export function targetCpa(ctx: GuardCtx) {
  return campaignOf(ctx)?.targetCpaCents ?? cpaCents(ctx.snapshot.totals30);
}

export function checkAction(a: GAction, ctx: GuardCtx): string | null {
  const now = ctx.now ?? Date.now();
  const snap = ctx.snapshot;
  const group = (id: string) => snap.adGroups.find((g) => g.id === id);
  switch (a.tool) {
    case "add_negative_keywords": {
      if (!a.terms.length) return "Give at least one search term to block.";
      if (a.terms.length > MAX_NEGATIVES_PER_ACTION) return `At most ${MAX_NEGATIVES_PER_ACTION} negatives at a time.`;
      for (const t of a.terms) {
        if (!cleanKeyword(t.text)) return `"${t.text}" isn't a usable keyword (letters, numbers and spaces, ${KEYWORD_MAX} characters at most).`;
        if (t.match === "BROAD") return `Use PHRASE or EXACT for "${t.text}": broad negatives block too much.`;
        if (t.match === "PHRASE" && CORE_WORDS.includes(t.text.toLowerCase().trim())) return `"${t.text}" on its own is the business: blocking it would stop the ads.`;
        const converted = snap.searchTerms.find((s) => s.conversions > 0 && blocks(t, s.term));
        if (converted) return `"${t.text}" would block "${converted.term}", which booked ${converted.conversions} conversion${converted.conversions === 1 ? "" : "s"}. Block something narrower.`;
        const own = snap.keywords.find((k) => k.status === "ENABLED" && blocks(t, k.text));
        if (own) return `"${t.text}" would block your own keyword "${own.text}". Pause the keyword instead, or block something narrower.`;
      }
      return null;
    }
    case "add_keywords": {
      const g = group(a.ad_group_id);
      if (!g) return "That ad group isn't in this account. Use an ad_group id from ad_groups.";
      if (!a.keywords.length || a.keywords.length > MAX_KEYWORDS_PER_ACTION) return `Add between 1 and ${MAX_KEYWORDS_PER_ACTION} keywords.`;
      for (const k of a.keywords) {
        const text = cleanKeyword(k.text);
        if (!text) return `"${k.text}" isn't a usable keyword.`;
        if (k.match === "BROAD") return `Add "${k.text}" as PHRASE or EXACT: broad match spends on loosely related searches, which a small roofing budget can't afford.`;
        if (snap.keywords.some((x) => x.adGroupId === a.ad_group_id && x.text.toLowerCase() === text && x.match === k.match && x.status !== "REMOVED")) return `"${k.text}" (${k.match}) is already a keyword in ${g.name}.`;
        const neg = snap.negatives.find((n) => blocks(n, text));
        if (neg) return `"${k.text}" is blocked by the negative "${neg.text}".`;
      }
      return null;
    }
    case "pause_keyword":
    case "resume_keyword": {
      const k = snap.keywords.find((x) => x.adGroupId === a.ad_group_id && x.criterionId === a.criterion_id);
      if (!k) return "That keyword isn't in the last 30 days' keywords.";
      if (a.tool === "resume_keyword") return k.status === "PAUSED" ? null : "That keyword isn't paused.";
      if (k.status !== "ENABLED") return "That keyword isn't running.";
      if (k.conversions > 0) return `"${k.text}" has ${k.conversions} conversion${k.conversions === 1 ? "" : "s"} in 30 days: keep it.`;
      const target = targetCpa(ctx);
      const need = target ? target * PAUSE_MIN_SPEND_X_TARGET : PAUSE_MIN_SPEND_CENTS;
      if (k.costCents < need) return `"${k.text}" spent ${usd(k.costCents)}; pausing needs ${usd(need)} with no conversion (${target ? `${PAUSE_MIN_SPEND_X_TARGET}x the target` : "no target yet"}).`;
      if (k.clicks < PAUSE_MIN_CLICKS) return `"${k.text}" has ${k.clicks} clicks; it needs ${PAUSE_MIN_CLICKS} before it has a verdict.`;
      const live = snap.keywords.filter((x) => x.adGroupId === a.ad_group_id && x.status === "ENABLED");
      if (live.length <= 1) return "That's the last running keyword in its ad group.";
      return null;
    }
    case "write_ad": {
      const g = group(a.ad_group_id);
      if (!g) return "That ad group isn't in this account.";
      const live = snap.ads.filter((x) => x.adGroupId === a.ad_group_id && x.status === "ENABLED");
      if (live.length >= MAX_ADS_PER_GROUP) return `${g.name} already has ${live.length} running ads; pause the weakest first.`;
      return checkAdText(a.headlines, a.descriptions, a.path1, a.path2);
    }
    case "pause_ad": {
      const ad = snap.ads.find((x) => x.adGroupId === a.ad_group_id && x.adId === a.ad_id);
      if (!ad) return "That ad isn't in this account.";
      if (ad.status !== "ENABLED") return "That ad isn't running.";
      const live = snap.ads.filter((x) => x.adGroupId === a.ad_group_id && x.status === "ENABLED");
      if (live.length <= 1) return "That's the last running ad in its ad group: write its replacement first.";
      if (ad.approval !== "DISAPPROVED" && ad.impressions < 1500) return `That ad has ${ad.impressions} impressions; it needs 1,500 before it has a verdict.`;
      return null;
    }
    case "set_daily_budget": {
      const camp = campaignOf(ctx);
      if (!camp?.budgetResource) return "There's no campaign budget to change yet.";
      const cap = dailyFromMonthly(ctx.monthlyCapCents);
      if (!Number.isInteger(a.daily_cents) || a.daily_cents < 1000) return "A daily budget is at least $10.";
      if (a.daily_cents > cap) return `The roofer's cap is ${usd(ctx.monthlyCapCents)} a month, so the daily budget can be at most ${usd(cap)}.`;
      const cur = camp.dailyBudgetCents;
      if (cur > cap && a.daily_cents <= cap) return null; // bringing it back under the cap is always allowed
      if (cur > 0 && Math.abs(a.daily_cents - cur) / cur > BUDGET_MAX_STEP + 1e-9) return `Each change is at most ${BUDGET_MAX_STEP * 100}%: from ${usd(cur)}, between ${usd(Math.ceil(cur * (1 - BUDGET_MAX_STEP)))} and ${usd(Math.floor(cur * (1 + BUDGET_MAX_STEP)))}.`;
      const since = daysSince(ctx.lastBudgetChangeAt, now);
      if (since < BUDGET_MIN_DAYS_BETWEEN) return `The budget changed ${Math.floor(since)} day(s) ago; wait ${BUDGET_MIN_DAYS_BETWEEN} days between changes.`;
      return null;
    }
    case "set_bidding": {
      const camp = campaignOf(ctx);
      if (!camp) return "There's no campaign yet.";
      if (daysSince(ctx.launchedAt, now) < LEARNING_DAYS) return `The campaign is in its first ${LEARNING_DAYS} days: leave bidding alone while Google learns.`;
      const since = daysSince(ctx.lastBiddingChangeAt, now);
      if (since < BIDDING_MIN_DAYS_BETWEEN) return `Bidding changed ${Math.floor(since)} day(s) ago; wait ${BIDDING_MIN_DAYS_BETWEEN} days (each change restarts Google's learning).`;
      if (a.strategy === "MAXIMIZE_CONVERSIONS") return a.target_cpa_cents ? "Maximize conversions without a target takes no target cost; use TARGET_CPA for one." : null;
      const conv = snap.totals30.conversions;
      if (conv < TARGET_CPA_MIN_CONVERSIONS) return `A target cost needs ${TARGET_CPA_MIN_CONVERSIONS}+ conversions in 30 days; there are ${conv}. Stay on Maximize conversions.`;
      const actual = cpaCents(snap.totals30)!;
      if (!a.target_cpa_cents || a.target_cpa_cents < Math.round(actual * TARGET_CPA_FLOOR)) return `The 30-day cost per conversion is ${usd(actual)}; a target below ${usd(Math.round(actual * TARGET_CPA_FLOOR))} would choke delivery.`;
      return null;
    }
    case "hold":
      return null;
  }
}

/** Responsive search ad text: Google's lengths and rules, and the roofing claims we never make. */
export function checkAdText(headlines: string[], descriptions: string[], path1 = "", path2 = ""): string | null {
  const hs = headlines.map((h) => h.trim()).filter(Boolean);
  const ds = descriptions.map((d) => d.trim()).filter(Boolean);
  if (hs.length < MIN_HEADLINES || hs.length > MAX_HEADLINES) return `Write ${MIN_HEADLINES} to ${MAX_HEADLINES} headlines (10+ is best).`;
  if (ds.length < MIN_DESCRIPTIONS || ds.length > MAX_DESCRIPTIONS) return `Write ${MIN_DESCRIPTIONS} to ${MAX_DESCRIPTIONS} descriptions.`;
  if (new Set(hs.map((h) => h.toLowerCase())).size !== hs.length) return "Every headline must be different.";
  for (const h of hs) {
    if (h.length > HEADLINE_MAX) return `"${h}" is ${h.length} characters; headlines are ${HEADLINE_MAX} at most.`;
    if (h.includes("!")) return `"${h}": Google doesn't allow "!" in headlines.`;
  }
  for (const d of ds) if (d.length > DESCRIPTION_MAX) return `A description is ${d.length} characters; ${DESCRIPTION_MAX} at most.`;
  for (const p of [path1, path2]) if (p && (p.length > PATH_MAX || !/^[A-Za-z0-9-]+$/.test(p))) return `Display path "${p}": up to ${PATH_MAX} letters, numbers or dashes.`;
  for (const t of [...hs, ...ds]) {
    if (/\b[A-Z]{5,}\b/.test(t.replace(/\b(GAF|HVAC|CERTAINTEED|OWENS)\b/gi, ""))) return `"${t}": no words in all caps (Google rejects it).`;
    if (/!!|\?\?|\$\$/.test(t)) return `"${t}": repeated punctuation isn't allowed.`;
    const why = roofingCopyProblem(t);
    if (why) return `"${t}": ${why}`;
  }
  return null;
}

/** What waits for an ask-first roofer's OK: anything that can raise spend or changes what the ads say. Savings go ahead. */
export function needsApproval(a: GAction, ctx: GuardCtx) {
  switch (a.tool) {
    case "add_negative_keywords":
    case "pause_keyword":
    case "pause_ad":
    case "hold":
      return false;
    case "set_daily_budget":
      return a.daily_cents > (campaignOf(ctx)?.dailyBudgetCents ?? 0);
    default:
      return true;
  }
}

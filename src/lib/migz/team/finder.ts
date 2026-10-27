import "server-only";
import { DateTime } from "luxon";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { callModel, defaultCreateMessage, monthlyBudget, planTier, textOf, type CreateMessage } from "@/lib/migz/router";
import { TOPICS, type TopicKey } from "@/lib/migz/topics";
import type { ModelTier } from "@/lib/migz/models";
import type { Traits } from "@/lib/migz/team/scout";

// The ad finder: every night Haiku with web search hunts for life insurance ads that are winning on
// Facebook, Instagram, TikTok, YouTube and X, from public pages (ad roundups, top-ads lists, case
// studies, articles that show the ads), and files the ones with evidence they work in the shared swipe
// file. It never scrapes the platforms or the Ad Library themselves (their terms forbid it); it reads
// what's public on the web. Reviews, the research shift and creative briefs learn from what it files.
// Shared work (not billed to one agent), two search passes per 10-minute research tick overnight, capped
// at FINDER_DAILY_USD a day.

export const FINDER_DAILY_USD = Number(process.env.MIGZ_FINDER_DAILY_USD || 5);
export const FINDER_ZONE = "America/Chicago";
export const FINDER_HOURS = { from: 1, to: 6 }; // 1am to 6am Central: overnight, between the agents' days
const SEARCHES_PER_PASS = 8;
const PASSES_PER_TICK = 2; // side by side, each on its own topic and platform
const MIN_WIN_SCORE = 2; // file only ads with real evidence they're working

// Weighted toward where the agents' ads run (Meta); YouTube and X rarely document life insurance winners
export const PLATFORMS = [
  "Facebook and Instagram (Meta) ads, including ones shown from the Meta Ad Library in articles and ad trackers",
  "Instagram Reels and Stories ads",
  "TikTok ads, including TikTok Creative Center's top ads",
  "YouTube and X (Twitter) ads",
] as const;

const FINDER_TOPICS = Object.keys(TOPICS) as TopicKey[];

/** True during the overnight window the finder runs in. */
export function finderWindow(now = new Date()) {
  const h = DateTime.fromJSDate(now).setZone(FINDER_ZONE).hour;
  return h >= FINDER_HOURS.from && h < FINDER_HOURS.to;
}

/** Which topic and platform a pass searches: tonight's passes walk through every pairing, a new start each night. */
export function finderQuery(passIndex: number, now = new Date()) {
  const day = Math.floor(DateTime.fromJSDate(now).setZone(FINDER_ZONE).startOf("day").toSeconds() / 86_400);
  const i = day * 7 + passIndex; // 7 is coprime with the 32 pairings, so each night starts somewhere new
  const topic = FINDER_TOPICS[i % FINDER_TOPICS.length];
  const platform = PLATFORMS[Math.floor(i / FINDER_TOPICS.length) % PLATFORMS.length];
  return { topic, platform };
}

export type Find = {
  source_url: string;
  platform: string;
  coverage?: string;
  advertiser: string;
  description: string;
  win_evidence: string;
  win_score: number;
  traits: Traits;
};

/** The ads a pass found, from its <finds> JSON; only ones with evidence they're winning. */
export function parseFinds(text: string): Find[] {
  const m = text.match(/<finds>([\s\S]*?)<\/finds>/);
  if (!m) return [];
  try {
    const parsed = JSON.parse(m[1]) as { finds?: Find[] };
    return (parsed.finds ?? [])
      .filter((f) => f && typeof f.description === "string" && typeof f.source_url === "string" && /^https?:\/\//.test(f.source_url) && f.traits)
      .filter((f) => Number(f.win_score) >= MIN_WIN_SCORE)
      .slice(0, 6);
  } catch {
    return [];
  }
}

const COVERAGE = FINDER_TOPICS.join(", ");

const FINDER_SYSTEM = `You are the ad finder on Migz AI's ad team, which runs Meta ads for independent US life insurance agents. Each pass you search the public web for life insurance ads that are winning, starting from one platform and one kind of coverage, so the team can learn what works. The coverage and platform are where to start, not a filter: file every winning life insurance ad you come across, tagged with its own coverage and platform.

Where to look: ad trackers and swipe sites that mirror the public Meta Ad Library with run lengths (search for insurers and agencies by name), top-ads lists (like TikTok Creative Center's), marketing case studies, ad roundups and teardown articles, and agency and insurer pages that show their ads. Use your searches: when one source comes up empty, try another. Read only public pages; never try to log in.

What counts as winning (win_score):
3 = documented results (cost per lead or appointment, sales, a case study with numbers, even when the ad itself isn't shown: describe what the case study says the ads did), or the ad has run 60+ days
2 = has run 30+ days, appears in many variants, or is on a top-ads list
1 = only shown as an example, no evidence it works (don't include these)

For each winning ad, describe what's in it (the hook, the first seconds or image, the story, the offer, the format) in your own words. Quote at most a few words of a hook; never copy ad copy. Record the evidence it's winning exactly as the source states it, and judge its compliance risk against Meta's financial-products rules (no guarantees, no implied approval, no calling out age, health or other personal attributes). Skip anything in already_filed. coverage is one of: ${COVERAGE}, or other.

Finish with only a JSON object inside <finds></finds> tags: {"finds":[{"source_url":string,"platform":string,"coverage":string,"advertiser":string,"description":string,"win_evidence":string,"win_score":2|3,"traits":{"angle":string,"hook_type":string,"opening_image":string,"emotional_tone":string,"setting":string,"text_legibility":string,"claims":[string],"compliance_risk":"low"|"medium"|"high","format":string,"offer":string}}]}. Use {"finds":[]} when nothing has real evidence.`;

async function spentToday() {
  const since = DateTime.now().setZone(FINDER_ZONE).startOf("day").toUTC().toISO()!;
  const { data } = await supabaseAdmin.from("model_calls").select("cost_usd").eq("task", "ad_finder").gte("created_at", since);
  return { usd: (data ?? []).reduce((n, r) => n + Number(r.cost_usd), 0), passes: data?.length ?? 0 };
}

/**
 * This tick's search passes, when it's the finder's window and tonight's cap isn't reached. Returns what
 * happened (for the cron's response).
 */
export async function findWinningAds(opts: { createMessage?: CreateMessage; now?: Date; force?: boolean } = {}) {
  const now = opts.now ?? new Date();
  if (!opts.force && !finderWindow(now)) return { status: "outside_window" as const };
  const spent = await spentToday();
  if (spent.usd >= FINDER_DAILY_USD) return { status: "daily_cap" as const, spentUsd: Number(spent.usd.toFixed(2)) };
  // Shared work has no agent budget; FINDER_DAILY_USD above is its cap
  const plan = planTier("ad_finder", await monthlyBudget(null, 0));
  if (!plan) return { status: "skipped" as const };

  const since = DateTime.fromJSDate(now).minus({ days: 60 }).toUTC().toISO()!;
  const { data: recent } = await supabaseAdmin.from("swipe_files").select("source_url").is("agent_id", null).gte("created_at", since).not("source_url", "is", null).limit(200);
  const filed = new Set((recent ?? []).map((r) => r.source_url as string));
  const passes = await Promise.all(
    Array.from({ length: PASSES_PER_TICK }, (_, k) => searchPass(finderQuery(spent.passes + k, now), filed, plan.tier, opts.createMessage ?? defaultCreateMessage)),
  );

  // Two passes can find the same page: file it once
  const seen = new Set<string>();
  const rows = passes.flatMap((p) => p.rows).filter((r) => !seen.has(r.source_url) && !!seen.add(r.source_url));
  if (rows.length) await supabaseAdmin.from("swipe_files").insert(rows);
  const costUsd = passes.reduce((n, p) => n + p.costUsd, 0);
  return {
    status: "searched" as const,
    passes: passes.map((p) => ({ topic: p.topic, platform: p.platform, found: p.rows.length })),
    filed: rows.length,
    costUsd: Number(costUsd.toFixed(3)),
    spentTodayUsd: Number((spent.usd + costUsd).toFixed(2)),
  };
}

async function searchPass(query: { topic: TopicKey; platform: string }, filed: Set<string>, tier: ModelTier, createMessage: CreateMessage) {
  const { topic, platform } = query;
  const res = await callModel({
    task: "ad_finder",
    tier,
    agentId: null, // shared work: not billed against one agent's ceiling
    runId: null,
    createMessage,
    params: {
      max_tokens: 10000,
      output_config: { effort: "low" },
      // Haiku 5.5 takes the basic web search tool; the dynamic-filtering version needs Sonnet/Opus
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: SEARCHES_PER_PASS }],
      system: [{ type: "text", text: FINDER_SYSTEM, cache_control: { type: "ephemeral" } }],
      messages: [
        {
          role: "user",
          content: JSON.stringify({
            coverage: `${TOPICS[topic].label}: ${TOPICS[topic].pitch}`,
            platform,
            already_filed: [...filed].slice(0, 80),
          }),
        },
      ],
    },
  });
  const rows = parseFinds(textOf(res.message))
    .filter((f) => !filed.has(f.source_url))
    .map((f) => ({
      agent_id: null,
      source_url: f.source_url.slice(0, 500),
      advertiser: f.advertiser?.slice(0, 120) || null,
      notes: `${f.description.slice(0, 700)}\nWhy it's winning: ${f.win_evidence.slice(0, 280)}`,
      traits: { ...f.traits, topic: f.coverage && f.coverage in TOPICS ? f.coverage : f.coverage === "other" ? null : topic, platform: f.platform?.slice(0, 80) || platform, win_evidence: f.win_evidence.slice(0, 280), win_score: Math.min(3, Number(f.win_score)) },
      added_by: "scout",
    }));
  return { topic, platform, rows, costUsd: res.costUsd };
}

import "server-only";
import { supabaseAdmin } from "@/lib/supabase-admin";
import type { Agent } from "@/lib/booking/data";
import { apifyReady, datasetItems, finished, getRun as getApifyRun, startRun as startApifyRun } from "@/lib/apify";
import { ACTORS, adLibraryUrl, advertisersFrom, cleanUrl, domainOf, facebookLinks, googleAdsFrom, googleInput, mapsInput, marketsFor, metaAdsFrom, metaInput, pageMatches } from "@/lib/competitors/normalize";
import { rankAds } from "@/lib/competitors/rank";
import { readAdImage, readOffers, rankOffers } from "@/lib/competitors/offers";
import { readPage } from "@/lib/competitors/web";
import { buildContext, readSite, siteOf } from "@/lib/competitors/context";
import { buildQuestions, askBuyer, finalPick, landingVersus, matchups, rulesPass, stripBrands, tally, verdict, writeLanding, writeLines, HEADLINES_TO_WRITE, DESCRIPTIONS_TO_WRITE, type Question } from "@/lib/competitors/writer";
import { pickBest, KEEP_DESCRIPTIONS, KEEP_HEADLINES } from "@/lib/competitors/gates";
import { getAdContext, getRun, logLine, saveAdContext, saveRun, type Job, type Run } from "@/lib/competitors/store";
import type { Advertiser, CompAd, Drafts, Headline, LandingPage } from "@/lib/competitors/types";

// The research run, one stage at a time. Apify runs take minutes, so each call to advanceRun does what it can in its
// time and returns; the admin page (while open) and the hourly Migz cron call it again until it's done.

const CLAIM_SECONDS = 290;
const GOOGLE_CONCURRENCY = 8;
// A full run, and a small test that runs every step end to end for a fraction of the cost
export const SIZES = {
  full: { advertisers: 50, metaPerPage: 30, imageReads: 300, sitePages: 10, headlines: HEADLINES_TO_WRITE, descriptions: DESCRIPTIONS_TO_WRITE, buyerRuns: 5, rounds: 3, matchups: 6 },
  small: { advertisers: 5, metaPerPage: 10, imageReads: 30, sitePages: 4, headlines: 30, descriptions: 10, buyerRuns: 3, rounds: 1, matchups: 3 },
} as const;
const sizeOf = (run: Pick<Run, "progress">) => SIZES[run.progress?.small ? "small" : "full"];

type Step = { run: Run; waiting?: boolean };

const isOpen = (j: Job) => !!j.runId && !finished(j.status as never) && j.status !== "SKIPPED";
const sumCost = (jobs: Job[]) => Math.round(jobs.reduce((s, j) => s + (j.usd || 0), 0) * 100) / 100;

async function agentOf(id: string) {
  const { data } = await supabaseAdmin.from("agents").select("*").eq("id", id).single();
  return data as Agent;
}

/** Starts a run for a roofer. Returns its id, or an error. */
export async function createRun(agent: Agent, opts: { budgetUsd: number; benchmark: string | null; by: string | null; small?: boolean }) {
  if (!apifyReady()) return { ok: false as const, error: "Add APIFY_API to the environment first." };
  const markets = marketsFor(agent.service_area, agent.licensed_states?.[0], opts.benchmark ?? "");
  if (!markets.some((m) => m.kind === "local")) return { ok: false as const, error: "This roofer has no service area yet (Start here → Plan your first campaign)." };
  const { data, error } = await supabaseAdmin
    .from("competitor_runs")
    .insert({ agent_id: agent.id, markets, budget_usd: Math.max(1, Math.min(100, opts.budgetUsd)), created_by: opts.by, progress: { small: !!opts.small }, log: [{ at: new Date().toISOString(), text: `Started${opts.small ? " a small test" : ""}: ${markets.map((m) => m.label).join(" and ")}, Apify budget $${opts.budgetUsd}` }] })
    .select("id")
    .single();
  if (error) return { ok: false as const, error: /competitor_runs/.test(error.message) ? "Run migration 20261215000000_competitor_research.sql first." : error.message };
  return { ok: true as const, id: data.id as string };
}

// ---------- Apify jobs ----------

/** Apify's limit on runs at once (the free plan allows 5). Jobs past it wait for a free slot. */
const MAX_CONCURRENT = () => Math.max(1, Number(process.env.APIFY_MAX_CONCURRENT) || 5);
const isConcurrencyError = (e: unknown) => /concurrent actor runs|concurrent runs/i.test((e as Error)?.message ?? "");

/** true: started (or already there). false: skipped or failed for good. "busy": no free Apify slot, try again later. */
async function startJob(run: Run, key: string, actor: string, input: unknown, maxUsd: number, meta: Record<string, unknown> = {}, maxItems?: number): Promise<boolean | "busy"> {
  if (run.jobs.some((j) => j.key === key)) return true;
  if (run.jobs.filter(isOpen).length >= MAX_CONCURRENT()) return "busy";
  if (sumCost(run.jobs) + maxUsd > run.budget_usd) {
    run.log = logLine(run, `Skipped ${key}: it could take the Apify spend past the $${run.budget_usd} budget.`);
    run.jobs.push({ key, actor, runId: null, status: "SKIPPED", usd: 0, meta });
    return false;
  }
  try {
    let r;
    try {
      r = await startApifyRun(actor, input, { maxUsd, maxItems });
    } catch (e) {
      // Some actors set a minimum spend cap per run ("allowed minimum of $0.50"): use it when the budget allows
      const min = Number((e as Error).message.match(/allowed minimum of \$([\d.]+)/)?.[1]);
      if (!min || min > 5 || sumCost(run.jobs) + min > run.budget_usd) throw e;
      r = await startApifyRun(actor, input, { maxUsd: min, maxItems });
    }
    run.jobs.push({ key, actor, runId: r.id, status: r.status, usd: 0, meta, datasetId: r.defaultDatasetId });
    return true;
  } catch (e) {
    if (isConcurrencyError(e)) return "busy";
    run.jobs.push({ key, actor, runId: null, status: "FAILED", usd: 0, meta, error: (e as Error).message.slice(0, 200) });
    run.log = logLine(run, `${key} failed to start: ${(e as Error).message.slice(0, 160)}`);
    return false;
  }
}

async function pollJobs(run: Run) {
  await Promise.all(
    run.jobs.filter(isOpen).map(async (j) => {
      try {
        const r = await getApifyRun(j.runId!);
        j.status = r.status;
        j.usd = Math.round((r.usageTotalUsd ?? 0) * 1000) / 1000;
        j.datasetId = r.defaultDatasetId;
      } catch {
        // try again next time
      }
    }),
  );
  run.cost_usd = sumCost(run.jobs);
}

async function itemsOf(j: Job | undefined, limit = 2000) {
  if (!j?.datasetId || !["SUCCEEDED", "TIMED-OUT", "ABORTED", "FAILED"].includes(j.status)) return [];
  return datasetItems(j.datasetId, limit).catch(() => []);
}

/** The roofer's own Google reviews: once their place is found, the reviews scraper. Runs alongside everything else. */
async function kickReviews(run: Run) {
  const place = run.jobs.find((j) => j.key === "own:place");
  if (!place || isOpen(place) || run.jobs.some((j) => j.key === "own:reviews")) return;
  const items = await itemsOf(place, 3);
  const url = (items[0] as { url?: string } | undefined)?.url;
  if (!url) {
    run.jobs.push({ key: "own:reviews", actor: ACTORS.reviews, runId: null, status: "SKIPPED", usd: 0, meta: { why: "no Google Business Profile found" } });
    return;
  }
  await startJob(run, "own:reviews", ACTORS.reviews, { startUrls: [{ url }], maxReviews: 40, reviewsSort: "newest", language: "en" }, 0.3, { place: items[0] });
}

// ---------- Stages ----------

async function maps(run: Run, agent: Agent): Promise<Step> {
  const missing = run.markets.filter((m) => !run.jobs.some((j) => j.key === `maps:${m.key}`));
  const localMarket = run.markets.find((m) => m.kind === "local");
  if (missing.length || (localMarket && !run.jobs.some((j) => j.key === "own:place"))) {
    if (!run.jobs.some((j) => j.key.startsWith("maps:"))) run.log = logLine(run, "Looking up the top roofers on Google Maps");
    const n = sizeOf(run).advertisers;
    for (const m of missing) await startJob(run, `maps:${m.key}`, ACTORS.maps, mapsInput(m, n), n <= 10 ? 0.5 : 0.6, { market: m.key }, n * 2);
    if (localMarket) await startJob(run, "own:place", ACTORS.maps, { ...mapsInput(localMarket, 1), searchStringsArray: [agent.full_name] }, 0.5, {}, 3);
    return { run, waiting: true };
  }
  if (run.jobs.some((j) => j.key.startsWith("maps:") && isOpen(j))) return { run, waiting: true };
  const site = await siteOf(agent.id);
  const own = { name: agent.full_name, domain: domainOf(site?.website) };
  const advertisers: Advertiser[] = [];
  for (const m of run.markets) advertisers.push(...advertisersFrom((await itemsOf(run.jobs.find((j) => j.key === `maps:${m.key}`))) as Record<string, unknown>[], m.key, own).slice(0, sizeOf(run).advertisers));
  // Nothing to research without competitors: stop here instead of paying for the rest
  const local = run.markets.find((m) => m.kind === "local");
  if (!advertisers.some((a) => a.market === local?.key)) {
    const job = run.jobs.find((j) => j.key === `maps:${local?.key}`);
    throw new Error(`Google Maps found no roofers around ${local?.label ?? "the service area"}${job?.error ? ` (${job.error})` : job?.status && job.status !== "SUCCEEDED" ? ` (the Maps run ${job.status.toLowerCase()})` : ""}.`);
  }
  run.advertisers = advertisers;
  run.stage = "homepages";
  run.log = logLine(run, `Found ${advertisers.length} roofers (${run.markets.map((m) => `${advertisers.filter((a) => a.market === m.key).length} in ${m.label}`).join(", ")})`);
  return { run };
}

async function homepages(run: Run, deadline: number): Promise<Step> {
  const idx = Number(run.progress.homeIdx ?? 0);
  const todo = run.advertisers.slice(idx);
  let done = 0;
  for (let i = 0; i < todo.length && Date.now() < deadline - 20_000; i += 8) {
    await Promise.all(
      todo.slice(i, i + 8).map(async (a) => {
        if (!a.website) return;
        const page = await readPage(a.website, 300_000);
        if (page) a.facebookUrls = facebookLinks(page.html);
      }),
    );
    done = Math.min(todo.length, i + 8);
  }
  run.progress = { ...run.progress, homeIdx: idx + done };
  if (idx + done >= run.advertisers.length) {
    run.stage = "ads";
    run.log = logLine(run, `${run.advertisers.filter((a) => a.facebookUrls.length).length} of them link a Facebook Page from their site`);
  }
  return { run };
}

async function ads(run: Run): Promise<Step> {
  if (!run.progress.adsStarted) {
    run.progress = { ...run.progress, adsStarted: true, googleQueue: run.advertisers.filter((a) => a.domain).map((a) => `${a.market}|${a.domain}`) };
    run.log = logLine(run, "Pulling every ad they run on Google and Facebook");
  }
  // Meta: one Ad Library pull per market, every competitor's Page (or their name, when their site links no Page)
  let metaWaiting = false;
  for (const m of run.markets) {
    if (run.jobs.some((j) => j.key === `meta:${m.key}`)) continue;
    const list = run.advertisers.filter((a) => a.market === m.key);
    const urls = [...new Set(list.map((a) => adLibraryUrl(m, a.facebookUrls[0] ? { pageUrl: a.facebookUrls[0] } : { name: a.name })))];
    const per = sizeOf(run).metaPerPage;
    if (urls.length && (await startJob(run, `meta:${m.key}`, ACTORS.meta, metaInput(urls, per), Math.min(4, 0.1 + urls.length * per * 0.002), { market: m.key }, urls.length * per)) === "busy") metaWaiting = true;
  }
  // Google: one Transparency Center pull per competitor domain, a few at a time
  const queue = [...((run.progress.googleQueue as string[]) ?? [])];
  while (queue.length && run.jobs.filter((j) => j.key.startsWith("google:") && isOpen(j)).length < GOOGLE_CONCURRENCY) {
    const key = queue.shift()!;
    const [market, domain] = key.split("|");
    const m = run.markets.find((x) => x.key === market)!;
    if ((await startJob(run, `google:${key}`, ACTORS.google, googleInput(domain, m), 0.25, { market, domain }, 40)) === "busy") {
      queue.unshift(key);
      break;
    }
  }
  run.progress = { ...run.progress, googleQueue: queue };
  if (metaWaiting || queue.length || run.jobs.some((j) => (j.key.startsWith("google:") || j.key.startsWith("meta:")) && isOpen(j))) return { run, waiting: true };

  const out: CompAd[] = [];
  for (const j of run.jobs.filter((x) => x.key.startsWith("google:"))) {
    const adv = run.advertisers.find((a) => a.market === j.meta.market && a.domain === j.meta.domain);
    if (adv) out.push(...googleAdsFrom((await itemsOf(j, 200)) as Record<string, unknown>[], adv.market, adv));
  }
  for (const m of run.markets) {
    const list = run.advertisers.filter((a) => a.market === m.key);
    // Each ad carries the URL it was found from: a Page's ads belong to that competitor; a name search's must match by name or site
    const fromUrl = new Map(list.map((a) => [adLibraryUrl(m, a.facebookUrls[0] ? { pageUrl: a.facebookUrls[0] } : { name: a.name }), a]));
    const byPage = (pageName: string, landing: string | null, inputUrl: string | null) => {
      const source = inputUrl ? fromUrl.get(inputUrl) : undefined;
      if (source && (source.facebookUrls[0] || pageMatches(source, pageName, [landing], m.label))) return source;
      return list.find((a) => pageMatches(a, pageName, [landing], m.label)) ?? null;
    };
    out.push(...metaAdsFrom((await itemsOf(run.jobs.find((j) => j.key === `meta:${m.key}`), 3000)) as Record<string, unknown>[], m.key, byPage));
  }
  const unique = [...new Map(out.map((a) => [`${a.market}|${a.id}`, a])).values()];
  for (const a of run.advertisers) {
    a.googleAds = unique.filter((x) => x.market === a.market && x.platform === "google" && x.domain === a.domain && x.advertiser).length;
    a.metaAds = unique.filter((x) => x.market === a.market && x.platform === "meta" && x.advertiser === a.name).length;
  }
  run.ads = unique;
  run.stage = "read";
  run.log = logLine(run, `${unique.filter((a) => a.platform === "google").length} Google ads and ${unique.filter((a) => a.platform === "meta").length} Facebook/Instagram ads from ${run.advertisers.filter((a) => a.googleAds || a.metaAds).length} advertisers`);
  return { run };
}

async function read(run: Run, agent: Agent, deadline: number): Promise<Step> {
  const tried = new Set((run.progress.readTried as string[]) ?? []);
  const unread = run.ads.filter((a) => a.platform === "google" && !a.headline && a.media.image && !tried.has(a.id)).sort((a, b) => (b.daysRunning ?? 0) - (a.daysRunning ?? 0));
  // Round-robin across competitors, so a capped read covers everyone rather than one advertiser's 30 ads
  const byAdv = new Map<string, CompAd[]>();
  for (const a of unread) byAdv.set(`${a.market}|${a.domain}`, [...(byAdv.get(`${a.market}|${a.domain}`) ?? []), a]);
  const spread: CompAd[] = [];
  for (let i = 0; spread.length < unread.length; i++) for (const list of byAdv.values()) if (list[i]) spread.push(list[i]);
  const toRead = spread.slice(0, Math.max(0, sizeOf(run).imageReads - tried.size));
  for (let i = 0; i < toRead.length && Date.now() < deadline - 40_000; i += 6) {
    await Promise.all(
      toRead.slice(i, i + 6).map(async (a) => {
        tried.add(a.id);
        const r = await readAdImage(agent.id, a.media.image!);
        if (!r) return;
        a.headline = r.headline?.slice(0, 200) ?? null;
        a.description = r.description?.slice(0, 400) ?? null;
        a.displayUrl = r.displayUrl ?? a.displayUrl;
        if (!a.landingUrl && a.displayUrl) a.landingUrl = cleanUrl(`https://${a.displayUrl.replace(/^https?:\/\//, "").replace(/\s|›/g, "/").replace(/\/+/g, "/")}`);
      }),
    );
  }
  run.progress = { ...run.progress, readTried: [...tried] };
  if (run.ads.some((a) => a.platform === "google" && !a.headline && a.media.image && !tried.has(a.id)) && tried.size < sizeOf(run).imageReads) return { run };

  // The page behind each ad
  const pages = new Map(run.pages.map((p) => [p.url, p]));
  const fetched = new Set((run.progress.pagesTried as string[]) ?? []);
  const urls = [...new Set(run.ads.map((a) => a.landingUrl).filter((u): u is string => !!u))].filter((u) => !fetched.has(u));
  for (let i = 0; i < urls.length && Date.now() < deadline - 20_000; i += 8) {
    await Promise.all(
      urls.slice(i, i + 8).map(async (u) => {
        fetched.add(u);
        const p = await readPage(u, 400_000);
        if (p) pages.set(u, { url: u, title: p.title, h1: p.h1, text: p.text.slice(0, 3000), offer: null, adIds: [] });
      }),
    );
  }
  run.progress = { ...run.progress, pagesTried: [...fetched] };
  if (urls.some((u) => !fetched.has(u))) {
    run.pages = [...pages.values()];
    return { run };
  }
  // A Google ad's display path ("roof/replacement") is often a vanity path, not a real page: the ad still lands on their
  // site, so it falls back to their homepage. Anything else whose page couldn't be read is out of the ranking.
  for (const a of run.ads) {
    if (!a.landingUrl || pages.has(a.landingUrl)) continue;
    const home = a.platform === "google" && a.domain && domainOf(a.landingUrl) === a.domain ? `https://${a.domain}/` : null;
    if (home && !pages.has(home)) {
      const p = await readPage(home, 400_000);
      if (p) pages.set(home, { url: home, title: p.title, h1: p.h1, text: p.text.slice(0, 3000), offer: null, adIds: [] });
    }
    a.landingUrl = home && pages.has(home) ? home : null;
  }
  for (const p of pages.values()) p.adIds = run.ads.filter((a) => a.landingUrl === p.url).map((a) => a.id);
  run.pages = [...pages.values()].filter((p) => p.adIds.length);
  run.stage = "rank";
  run.log = logLine(run, `Read ${tried.size} Google ad images and ${run.pages.length} landing pages`);
  return { run };
}

async function rank(run: Run, agent: Agent): Promise<Step> {
  rankAds(run.ads, run.markets);
  const ranked = run.ads.filter((a) => !a.excluded).slice(0, 400);
  await readOffers(agent.id, ranked);
  await rankOffers(agent.id, ranked);
  run.stage = "context";
  run.log = logLine(run, `Kept ${run.ads.filter((a) => a.top).length} top ads (best 15% per list) and found ${ranked.filter((a) => a.offer).length} real offers`);
  return { run };
}

async function context(run: Run, agent: Agent): Promise<Step> {
  await kickReviews(run);
  const reviews = run.jobs.find((j) => j.key === "own:reviews");
  if (run.jobs.some((j) => j.key.startsWith("own:") && isOpen(j)) || !reviews) return { run, waiting: true };
  const site = await siteOf(agent.id);
  const pages = await readSite(site?.website ?? null, sizeOf(run).sitePages);
  const placeItems = await itemsOf(run.jobs.find((j) => j.key === "own:place"), 3);
  const ctx = await buildContext(agent, { pages, place: (placeItems[0] as never) ?? null, reviews: (await itemsOf(reviews, 60)) as never });
  await saveAdContext(agent.id, ctx);
  run.stage = "write";
  run.log = logLine(run, `Your business: read ${pages.length} pages of ${site?.website ?? "no website on file"}, ${ctx.reviews.count ?? 0} Google reviews (${ctx.reviews.quotes.length} quotes kept), ${ctx.testimonials.length} testimonials, ${ctx.videos.length} videos`);
  return { run };
}

const winnersOf = (run: Run) => run.ads.filter((a) => a.top).sort((a, b) => (a.platform === b.platform ? (b.score ?? 0) - (a.score ?? 0) : a.platform === "google" ? -1 : 1));
const offersOf = (run: Run) => run.ads.filter((a) => a.offerRank).sort((a, b) => a.offerRank! - b.offerRank!);
const namesOf = (run: Run) => [...new Set([...run.advertisers.map((a) => a.name), ...run.ads.map((a) => a.advertiser)])];

function rivalLines(run: Run, kind: "headline" | "description") {
  const names = namesOf(run);
  const source = winnersOf(run).length >= 3 ? winnersOf(run) : run.ads.filter((a) => !a.excluded);
  const lines = source.map((a) => (kind === "headline" ? a.headline : a.description ?? a.body)).filter((t): t is string => !!t).map((t) => stripBrands(t, names).slice(0, kind === "headline" ? 60 : 140));
  return [...new Set(lines)].slice(0, 30);
}

const emptyDrafts = (headlines: Headline[], descriptions: Headline[]): Drafts => ({
  headlines,
  descriptions,
  kept: { headlines: [], descriptions: [], path1: "roof", path2: "replacement" },
  counts: { written: headlines.length, rules: 0, buyer: 0, variety: 0, kept: 0 },
  matchups: [],
  landing: null,
  verdict: { publishable: false, minConfidence: 0, why: "Still testing." },
  writtenAt: new Date().toISOString(),
});

async function write(run: Run, agent: Agent): Promise<Step> {
  const ctx = await getAdContext(agent.id);
  if (!ctx) throw new Error("No ad context yet.");
  const [headlines, descriptions] = await Promise.all([
    writeLines(agent, ctx, winnersOf(run), offersOf(run), "headline", sizeOf(run).headlines),
    writeLines(agent, ctx, winnersOf(run), offersOf(run), "description", sizeOf(run).descriptions),
  ]);
  rulesPass(headlines, "headline", ctx, namesOf(run));
  rulesPass(descriptions, "description", ctx, namesOf(run));
  const questions = [
    ...buildQuestions(headlines.filter((h) => h.stage !== "rules"), rivalLines(run, "headline"), sizeOf(run).buyerRuns),
    ...buildQuestions(descriptions.filter((h) => h.stage !== "rules"), rivalLines(run, "description"), sizeOf(run).buyerRuns),
  ];
  run.drafts = emptyDrafts(headlines, descriptions);
  run.progress = { ...run.progress, buyer: { questions, picks: {}, round: 1 } };
  run.stage = "buyer";
  run.log = logLine(run, `Wrote ${headlines.length} headlines and ${descriptions.length} descriptions; ${headlines.filter((h) => h.stage !== "rules").length} headlines passed the rules`);
  return { run };
}

type BuyerProgress = { questions: Question[]; picks: Record<string, { pick: number; why: string }>; round: number };

async function buyer(run: Run, agent: Agent, deadline: number): Promise<Step> {
  const ctx = (await getAdContext(agent.id))!;
  const b = run.progress.buyer as BuyerProgress;
  const pending = b.questions.filter((q) => !b.picks[q.q]);
  const sheets: Question[][] = [];
  for (let i = 0; i < pending.length; i += 50) sheets.push(pending.slice(i, i + 50));
  for (let i = 0; i < sheets.length && Date.now() < deadline - 60_000; i += 6) {
    const answers = await Promise.all(sheets.slice(i, i + 6).map((s) => askBuyer(agent.id, ctx.business.buyer, s).catch(() => new Map())));
    for (const m of answers) for (const [q, a] of m) b.picks[q] = { pick: a.pick, why: a.why };
  }
  run.progress = { ...run.progress, buyer: b };
  if (b.questions.some((q) => !b.picks[q.q])) return { run };

  const d = run.drafts!;
  const notes = [...tally(d.headlines, b.questions, b.picks), ...tally(d.descriptions, b.questions, b.picks)];
  // Enough for one ad? (checked on a copy: the real pick happens at the end)
  const copy = (pool: Headline[]) => pool.map((h) => ({ ...h }));
  const h = pickBest(copy(d.headlines), KEEP_HEADLINES);
  const ds = pickBest(copy(d.descriptions), KEEP_DESCRIPTIONS);
  if ((h.picked.length < KEEP_HEADLINES || ds.picked.length < KEEP_DESCRIPTIONS || !h.varietyOk) && b.round < sizeOf(run).rounds) {
    // The gate never lowers: write again from why the buyer picked theirs
    const [moreH, moreD] = await Promise.all([
      h.picked.length < KEEP_HEADLINES || !h.varietyOk ? writeLines(agent, ctx, winnersOf(run), offersOf(run), "headline", 60, notes.slice(0, 30).join("\n")) : Promise.resolve([]),
      ds.picked.length < KEEP_DESCRIPTIONS ? writeLines(agent, ctx, winnersOf(run), offersOf(run), "description", 20, notes.slice(0, 30).join("\n")) : Promise.resolve([]),
    ]);
    rulesPass(moreH, "headline", ctx, namesOf(run));
    rulesPass(moreD, "description", ctx, namesOf(run));
    d.headlines.push(...moreH);
    d.descriptions.push(...moreD);
    b.questions.push(...buildQuestions(moreH.filter((x) => x.stage !== "rules"), rivalLines(run, "headline"), sizeOf(run).buyerRuns), ...buildQuestions(moreD.filter((x) => x.stage !== "rules"), rivalLines(run, "description"), sizeOf(run).buyerRuns));
    b.round++;
    run.progress = { ...run.progress, buyer: b };
    run.log = logLine(run, `Round ${b.round}: ${h.picked.length} headlines and ${ds.picked.length} descriptions passed, so ${moreH.length + moreD.length} more were written from why the buyer picked theirs`);
    return { run };
  }
  run.stage = "judge";
  return { run };
}

async function judge(run: Run, agent: Agent): Promise<Step> {
  const ctx = (await getAdContext(agent.id))!;
  const d = run.drafts!;
  const passedRules = (pool: Headline[]) => pool.filter((x) => x.stage !== "rules").length;
  const passedBuyer = (pool: Headline[]) => pool.filter((x) => x.stage !== "rules" && x.stage !== "buyer").length;
  const counts = { written: d.headlines.length, rules: passedRules(d.headlines), buyer: passedBuyer(d.headlines), variety: 0, kept: 0 };
  const kept = finalPick(d.headlines, d.descriptions);
  counts.variety = d.headlines.filter((x) => x.stage === "kept" || x.stage === "spare").length;
  counts.kept = kept.headlines.length;
  const winners = winnersOf(run);
  const games = kept.headlines.length >= 3 && kept.descriptions.length >= 2 ? await matchups(agent.id, ctx.business.buyer, kept, winners.slice(0, sizeOf(run).matchups), namesOf(run)) : [];
  let landing: Drafts["landing"] = null;
  if (kept.headlines.length) {
    const page = await writeLanding(agent, ctx, winners, offersOf(run), kept);
    if (page) {
      const theirPages = winners.map((w) => run.pages.find((p) => p.url === w.landingUrl)).filter((p, i, all): p is LandingPage => !!p && all.indexOf(p) === i);
      landing = { ...page, versus: theirPages.length ? await landingVersus(agent.id, ctx.business.buyer, page, theirPages, namesOf(run)) : [] };
    }
  }
  run.drafts = { ...d, kept: { ...d.kept, headlines: kept.headlines, descriptions: kept.descriptions }, counts, matchups: games, landing, verdict: verdict(kept, games), writtenAt: new Date().toISOString() };
  run.stage = "done";
  run.status = "done";
  run.finished_at = new Date().toISOString();
  run.log = logLine(run, `${kept.headlines.length} headlines and ${kept.descriptions.length} descriptions kept. ${run.drafts.verdict.why}`);
  return { run };
}

// ---------- Driving it ----------

async function step(run: Run, agent: Agent, deadline: number): Promise<Step> {
  await pollJobs(run);
  await kickReviews(run);
  switch (run.stage) {
    case "maps":
      return maps(run, agent);
    case "homepages":
      return homepages(run, deadline);
    case "ads":
      return ads(run);
    case "read":
      return read(run, agent, deadline);
    case "rank":
      return rank(run, agent);
    case "context":
      return context(run, agent);
    case "write":
      return write(run, agent);
    case "buyer":
      return buyer(run, agent, deadline);
    case "judge":
      return judge(run, agent);
    default:
      return { run, waiting: true };
  }
}

/** Moves a run along until it has to wait on Apify, runs out of time, or finishes. */
export async function advanceRun(id: string, deadline = Date.now() + 240_000): Promise<Run | null> {
  const stale = new Date(Date.now() - CLAIM_SECONDS * 1000).toISOString();
  const token = new Date().toISOString();
  const { data: claimed } = await supabaseAdmin.from("competitor_runs").update({ claimed_at: token }).eq("id", id).eq("status", "running").or(`claimed_at.is.null,claimed_at.lt.${stale}`).select("id");
  if (!claimed?.length) return getRun(id);
  let run = (await getRun(id))!;
  const agent = await agentOf(run.agent_id);
  try {
    for (let i = 0; i < 12 && Date.now() < deadline - 30_000; i++) {
      const before = run.stage;
      const s = await step(run, agent, deadline);
      run = s.run;
      await saveRun(id, { stage: run.stage, status: run.status, jobs: run.jobs, advertisers: run.advertisers, ads: run.ads, pages: run.pages, drafts: run.drafts, progress: run.progress, cost_usd: run.cost_usd, log: run.log, finished_at: run.finished_at });
      if (run.status !== "running" || (s.waiting && run.stage === before)) break;
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    run.log = logLine(run, `Stopped at ${run.stage}: ${message.slice(0, 200)}`);
    await saveRun(id, { status: "failed", error: message.slice(0, 500), log: run.log, jobs: run.jobs, cost_usd: run.cost_usd });
  } finally {
    await supabaseAdmin.from("competitor_runs").update({ claimed_at: null }).eq("id", id).eq("claimed_at", token);
  }
  return getRun(id);
}

/** Every running research run, from the hourly cron. */
export async function advanceOpenRuns(deadline: number) {
  if (!apifyReady()) return {};
  const { data, error } = await supabaseAdmin.from("competitor_runs").select("id").eq("status", "running").order("updated_at", { ascending: true }).limit(5);
  if (error || !data?.length) return {};
  const out: Record<string, string> = {};
  for (const r of data) {
    if (Date.now() > deadline - 40_000) break;
    const run = await advanceRun(r.id as string, deadline);
    out[r.id as string] = run ? `${run.status}:${run.stage}` : "missing";
  }
  return out;
}

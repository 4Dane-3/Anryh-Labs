// Run: NODE_PATH=scripts/migz/stubs TSX_TSCONFIG_PATH=./tsconfig.json node --import tsx scripts/migz/competitors.test.mts
import assert from "node:assert/strict";
import { adLibraryUrl, pageMatches, advertisersFrom, cleanUrl, domainOf, facebookLinks, googleAdsFrom, marketsFor, metaAdsFrom } from "../../src/lib/competitors/normalize.ts";
import { exclusion, rankAds } from "../../src/lib/competitors/rank.ts";
import { checkLine, numbersIn, pickBest, proofText, similarity } from "../../src/lib/competitors/gates.ts";
import { buildQuestions, stripBrands, tally, verdict } from "../../src/lib/competitors/scoring.ts";
import type { AdContext, CompAd, Headline, Matchup } from "../../src/lib/competitors/types.ts";

// ---------- Markets and inputs ----------
const markets = marketsFor("Kent", "WA");
assert.deepEqual(markets.map((m) => [m.key, m.query, m.region]), [["local", "Kent, WA, USA", "US"], ["benchmark", "Dublin, Ireland", "IE"]]);
assert.equal(marketsFor("1520 K Ave, Plano, TX", "TX")[0].query, "1520 K Ave, Plano, TX, USA");
assert.equal(marketsFor("", null, "").length, 0);
assert.match(adLibraryUrl(markets[0], { pageUrl: "https://www.facebook.com/profile.php?id=123456789" }), /view_all_page_id=123456789/);
assert.match(adLibraryUrl(markets[1], { name: "Summit Roofing | Trusted Roofers" }), /country=IE.*q=Summit%20Roofing$/);
assert.equal(adLibraryUrl(markets[0], { pageUrl: "https://www.facebook.com/ABetterRoofingCompany" }), "https://www.facebook.com/ABetterRoofingCompany");
assert.ok(pageMatches({ name: "A Better Roofing Co Inc", domain: "abetterroofing.com" }, "A Better Roofing Company", []));
assert.ok(!pageMatches({ name: "Roof Repair", domain: "roof-repair.ie" }, "EduVibe", ["https://finaax.com/x"]));
assert.ok(pageMatches({ name: "Irish Roofers Dublin - Roofing Contractors", domain: "irishroofers.ie" }, "Irish Roofers", [], "Dublin"));
assert.ok(!pageMatches({ name: "Emergency Roofers Dublin", domain: "emergencyroofersdublin.ie" }, "Dublin Roofing Services", [], "Dublin"));
assert.ok(pageMatches({ name: "Everlasting Roofing & Guttering", domain: "everlastingroofingdublin.ie" }, "Everlasting Roofing and Guttering", [], "Dublin"));
assert.equal(domainOf("https://www.SummitRoof.com/x"), "summitroof.com");
assert.equal(domainOf("https://facebook.com/summit"), null);
assert.equal(cleanUrl("https://summitroof.com/roof?utm_source=fb&fbclid=1&x=2"), "https://summitroof.com/roof?x=2");
assert.equal(cleanUrl("https://l.facebook.com/l.php?u=x"), null);
assert.deepEqual(facebookLinks('<a href="https://www.facebook.com/people/Smart-Choice-Roofing/61550000000000/">fb</a>'), ["https://www.facebook.com/people/Smart-Choice-Roofing/61550000000000"]);
assert.match(adLibraryUrl(markets[0], { pageUrl: "https://www.facebook.com/people/Smart-Choice-Roofing/61550000000000" }), /view_all_page_id=61550000000000/);
assert.deepEqual(facebookLinks('<a href="https://www.facebook.com/SummitRoofingWA/">fb</a><a href="https://facebook.com/sharer.php?u=x">share</a>'), ["https://www.facebook.com/SummitRoofingWA"]);

// ---------- Google Maps → advertisers ----------
const advs = advertisersFrom(
  [
    { title: "Summit Roofing", website: "https://summitroof.com", totalScore: 4.8, reviewsCount: 212, categoryName: "Roofing contractor" },
    { title: "Summit Roofing LLC", website: "https://www.summitroof.com/contact" }, // same domain
    { title: "Kent Plumbing", website: "https://kentplumb.com", categoryName: "Plumber" }, // not a roofer
    { title: "Martinez Roofing", website: "https://martinezroofing.com", categoryName: "Roofing contractor" }, // the roofer themself
    { title: "Peak Exteriors", categoryName: "Roofing contractor" },
  ],
  "local",
  { name: "Martinez Roofing", domain: "martinezroofing.com" },
);
assert.deepEqual(advs.map((a) => a.name), ["Summit Roofing", "Peak Exteriors"]);
assert.equal(advs[0].rating, 4.8);

// ---------- Ads ----------
const g = googleAdsFrom([{ creativeId: "CR1", adFormat: "TEXT", firstShown: "2026-08-01", lastShown: "2026-11-10", imageUrl: "https://tpc.googlesyndication.com/x.png", adUrl: "https://adstransparency.google.com/x" }], "local", advs[0]);
assert.equal(g[0].id, "google-CR1");
assert.equal(g[0].daysRunning, 101);
assert.equal(g[0].format, "text");
const eu = googleAdsFrom([{ creativeId: "CR2", adFormat: "IMAGE", firstShown: "2026-10-01", lastShown: "2026-11-10", regionStats: [{ impressions: { lowerBound: 10000, upperBound: 20000 } }] }], "benchmark", { ...advs[0], market: "benchmark" });
assert.deepEqual(eu[0].impressionsRange, [10000, 20000]);
assert.equal(eu[0].impressionsPerDay, Math.round(15000 / 40));
const meta = metaAdsFrom(
  [
    { adArchiveID: "111", pageName: "Summit Roofing", startDateFormatted: "2026-09-01", isActive: true, collationCount: 3, snapshot: { title: "New roof, $1,000 off", body: { text: "Replace your roof this fall and get $1,000 off." }, linkUrl: "https://summitroof.com/fall?utm_source=fb" } },
    { adArchiveID: "222", pageName: "Summit Roofing", startDateFormatted: "2026-11-05", snapshot: { title: "Roof inspection", body: { text: "Book a free inspection." }, linkUrl: "https://summitroof.com/" } },
    { adArchiveID: "333", pageName: "Someone Else", snapshot: { title: "x", linkUrl: "https://other.com" } },
  ],
  "local",
  (name, landing) => (domainOf(landing) === "summitroof.com" ? advs[0] : null),
  "2026-11-12",
);
assert.deepEqual(meta.map((a) => [a.id, a.impressionsRank, a.daysRunning]), [["meta-111", 1, 72], ["meta-222", 2, 7]]);
assert.equal(meta[0].landingUrl, "https://summitroof.com/fall");
assert.equal(meta[0].body, "Replace your roof this fall and get $1,000 off.");

assert.equal(metaAdsFrom([{ inputUrl: "x", results: [{ adArchiveID: "9", pageName: "Summit Roofing", startDateFormatted: "2026-09-01", snapshot: { title: "t", linkUrl: "https://summitroof.com/" } }] }], "local", () => advs[0], "2026-11-12").length, 1);

// ---------- Ranking ----------
const base = (over: Partial<CompAd>): CompAd => ({ ...meta[0], id: Math.random().toString(36), ...over });
const ads: CompAd[] = [
  base({ id: "a", impressionsRank: 1, daysRunning: 60, headline: "A", body: "one" }),
  base({ id: "b", impressionsRank: 2, daysRunning: 40, headline: "B", body: "two" }),
  base({ id: "c", impressionsRank: 3, daysRunning: 9, headline: "C", body: "three" }), // too new
  base({ id: "d", impressionsRank: 4, daysRunning: 30, headline: "A", body: "one" }), // copy of a
  base({ id: "e", impressionsRank: 5, daysRunning: 30, headline: "E", body: "Now hiring roofers" }),
  base({ id: "f", impressionsRank: 6, daysRunning: 30, headline: "F", body: "six", landingUrl: null }),
  ...Array.from({ length: 20 }, (_, i) => base({ id: `x${i}`, impressionsRank: 7 + i, daysRunning: 30, headline: `X${i}`, body: `ad ${i}` })),
];
rankAds(ads, [markets[0]]);
const byId = (id: string) => ads.find((a) => a.id === id)!;
assert.equal(byId("a").rank, 1);
assert.equal(byId("a").copies, 4); // 3 from Meta + the copy
assert.match(byId("c").excluded!, /under 14/);
assert.equal(byId("d").duplicateOf, "a");
assert.equal(byId("e").excluded, "A hiring post");
assert.equal(byId("f").excluded, "No landing page found");
assert.equal(ads.filter((a) => a.top).length, Math.ceil(22 * 0.15)); // 22 ranked → best 15% = 4
assert.match(byId("a").clue!, /#1 in Meta's impressions order/);
assert.equal(exclusion(base({ headline: "Google Guaranteed roofer" })), "A Local Services or Maps ad");

// ---------- Filter 1: the rules ----------
const ctx = {
  proof: { gap: "", offer: [{ claim: "$500 off a full roof replacement", adForm: "$500 off a new roof", source: "setup" }], promises: [{ claim: "GAF Golden Pledge warranty", adForm: "GAF Golden Pledge warranty", source: "setup" }, { claim: "Licensed and insured", adForm: "Licensed and insured", source: "site" }], numbers: [{ claim: "25 years in business", adForm: "25 years roofing Kent", source: "site" }], hold: [], never: [] },
  reviews: { rating: 4.9, count: 87, placeUrl: null, quotes: [] },
} as unknown as AdContext;
const proof = proofText(ctx);
const rules = (t: string, kind: "headline" | "description" = "headline") => checkLine(t, kind, { proof, competitors: ["Summit Roofing", "Peak Exteriors"] });
assert.equal(rules("$500 off a new roof"), null);
assert.equal(rules("25 years roofing Kent"), null);
assert.equal(rules("Licensed and insured roofers"), null);
assert.equal(rules("Rated 4.9 by 87 neighbors"), null);
assert.match(rules("$1,000 off a new roof")!, /\$1000.*proof/);
assert.match(rules("30 years of roofing")!, /proof/);
assert.match(rules("The best roofers in Kent")!, /Banned/);
assert.match(rules("Free roof inspection today!")!, /"!"/);
assert.match(rules("A roof that lasts a lifetime of storms")!, /characters/);
assert.match(rules("Better than Summit Roofing")!, /competitor/);
assert.match(rules("Call 425-555-0100 now")!, /phone/);
assert.match(rules("CALL TODAY")!, /all caps/);
assert.match(rules("Certified by every maker")!, /certified/i);
assert.match(rules("We cover your deductible")!, /deductible/i);
assert.match(rules("Certified GAF roofers")!, /Certified/); // a warranty on file isn't a certification
assert.deepEqual(numbersIn("$1,000 off, 25 years, 4.9 stars"), ["$1000", "25 years", "4.9 stars"]);
assert.ok(similarity("Free roof inspection today", "Free roof inspection, today") > 0.88);

// ---------- Filter 3 and the pick ----------
const line = (text: string, angle: Headline["angle"], wins = 5): Headline => ({ id: text, text, angle, stage: "spare", reason: null, wins, runs: 5 });
const pool = [
  line("$500 off a new roof", "offer"),
  line("$500 off a new roof.", "offer"), // near copy
  line("Price in writing first", "price"),
  line("Inspection this week", "speed"),
  line("Licensed and insured", "trust"),
  line("No pressure, no hard sell", "risk-reversal"),
  line("Book your free inspection", "ask"),
  line("Lost line", "ask", 1),
];
pool[7].stage = "buyer";
const pick = pickBest(pool, 15);
assert.equal(pick.picked.length, 6);
assert.equal(pool[1].stage, "repeat");
assert.ok(pick.varietyOk);
const offerHeavy = ["Gutters free with a roof", "Upgrade shingles at no cost", "$500 off this month", "Free attic vent check", "Ten percent off repairs", "Free skylight reseal", "Ridge vents included", "Free haul away", "Drip edge at no charge", "Free storm photos"].map((t) => line(t, "offer"));
assert.equal(pickBest(offerHeavy, 15).picked.length, 5); // no angle over a third of 15

// ---------- Filter 2 bookkeeping ----------
assert.equal(stripBrands("Summit Roofing: call summitroof.com", ["Summit Roofing"]), "[company]: call [company]");
let seed = 1;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const lines = [line("Ours A", "offer", 0), line("Ours B", "trust", 0)];
const qs = buildQuestions(lines, ["Theirs 1", "Theirs 2", "Theirs 3", "Theirs 4"], 5, rand);
assert.equal(qs.length, 10);
assert.ok(qs.every((q) => q.options.length === 4 && q.options[q.ours].startsWith("Ours")));
const picks = Object.fromEntries(qs.map((q) => [q.q, { pick: q.lineId === "Ours A" ? q.ours + 1 : ((q.ours + 1) % 4) + 1, why: "theirs was specific" }]));
tally(lines, qs, picks);
assert.equal(lines[0].stage, "spare");
assert.equal(lines[0].wins, 5);
assert.equal(lines[1].stage, "buyer");
assert.match(lines[1].reason!, /0 of 5/);

// ---------- The 9/10 gate ----------
const game = (confidence: number): Matchup => ({ ours: { headlines: [], descriptions: [] }, theirs: { id: "t", advertiser: "Summit", headline: "x", text: "y" }, confidence, why: "because" });
const full = { headlines: Array(15).fill("h"), descriptions: Array(4).fill("d"), varietyOk: true };
assert.equal(verdict(full, [game(9), game(10)]).publishable, true);
assert.equal(verdict(full, [game(9), game(8)]).publishable, false);
assert.equal(verdict({ ...full, headlines: Array(12).fill("h") }, [game(10)]).publishable, false);
assert.equal(verdict(full, []).publishable, false);

console.log("competitor research tests passed");

// Run: NODE_PATH=scripts/migz/stubs TSX_TSCONFIG_PATH=./tsconfig.json node --import tsx scripts/migz/research-live.test.mts
// Competitor research feeding the live campaign: which copy is used, and when the first build waits for it.
import assert from "node:assert/strict";
import { firstBuildStep, RESEARCH_WAIT_HOURS, talksBooking, usableLanding, winningAd, withoutBooking } from "../../src/lib/competitors/live-copy.ts";
import { campaignOperations } from "../../src/lib/google-ads/build.ts";
import type { Drafts } from "../../src/lib/competitors/types.ts";
import type { Agent } from "../../src/lib/booking/data.ts";

// ---------- Booking language ----------
assert.ok(talksBooking("Book your free inspection"));
assert.ok(talksBooking("Pick a time that suits you"));
assert.ok(talksBooking("Schedule online"));
assert.ok(!talksBooking("Request your free quote"));
assert.ok(!talksBooking("A bookkeeper's roof")); // whole words only
assert.equal(withoutBooking("We show you photos. Book online in a minute. No pressure."), "We show you photos. No pressure.");

// ---------- Landing copy: only when it won 9/10 against every competitor page ----------
const landing = (versus: number[]): Pick<Drafts, "landing"> => ({
  landing: {
    headline: "Book your free roof inspection",
    subhead: "Photos of everything we find, and a written price before any work.",
    offer: "Free roof inspection with photos",
    proof: ["GAF Master Elite", "Book online 24/7", "WA Lic #ABC123"],
    sections: [
      { title: "What happens at the inspection", body: "We check shingles, flashing and vents. Pick a time that suits you. You get photos of all of it." },
      { title: "Book in a minute", body: "Choose a slot." },
      { title: "Why us", body: "A local crew, licensed and insured." },
    ],
    cta: "Book my free inspection",
    versus: versus.map((confidence, i) => ({ url: `https://competitor${i}.com`, confidence, why: "" })),
  },
});
assert.equal(usableLanding(landing([8, 10, 10])), null, "one page it wasn't 9/10 sure about: not used");
assert.equal(usableLanding(landing([])), null, "never tested against a competitor page: not used");
assert.equal(usableLanding(null), null);
const used = usableLanding(landing([9, 10]))!;
assert.equal(used.confidence, 9);
assert.equal(used.subhead, "Photos of everything we find, and a written price before any work.");
assert.equal(used.cta, null, "a booking CTA falls back to the page's own");
assert.deepEqual(used.proof, ["GAF Master Elite", "WA Lic #ABC123"], "booking proof lines dropped");
assert.deepEqual(
  used.sections.map((s) => s.title),
  ["What happens at the inspection", "Why us"],
  "a booking section is dropped",
);
assert.equal(used.sections[0].body, "We check shingles, flashing and vents. You get photos of all of it.", "booking sentences dropped from a kept section");

// ---------- The ad: only when the 9/10 gate passed ----------
const kept = { headlines: Array.from({ length: 15 }, (_, i) => `Headline ${i + 1}`), descriptions: ["One.", "Two.", "Three.", "Four."], path1: "roofing", path2: "" };
assert.equal(winningAd({ kept, verdict: { publishable: false, minConfidence: 8, why: "" } }), null);
assert.deepEqual(winningAd({ kept, verdict: { publishable: true, minConfidence: 9, why: "" } }), kept);

// ---------- When the first build goes ahead ----------
const now = Date.parse("2026-11-15T12:00:00Z");
const hoursAgo = (h: number) => new Date(now - h * 3_600_000).toISOString();
assert.equal(firstBuildStep({ status: "none" }, true, now), "start", "Google just turned on: start research");
assert.equal(firstBuildStep({ status: "none" }, false, now), "build", "no Apify: build with the playbook's ads, don't wait");
assert.equal(firstBuildStep({ status: "running", startedAt: hoursAgo(1) }, true, now), "wait");
assert.equal(firstBuildStep({ status: "running", startedAt: hoursAgo(RESEARCH_WAIT_HOURS + 0.1) }, true, now), "build", "a slow run never holds the campaign back");
assert.equal(firstBuildStep({ status: "done" }, true, now), "build");
assert.equal(firstBuildStep({ status: "failed" }, true, now), "build", "a failed or canceled run doesn't start another");

// ---------- The build: the winning ad next to each group's own ----------
const agent = { id: "a", slug: "lone-star", full_name: "Lone Star Roofing", vertical: "roofing", service_area: "Plano, TX", licensed_states: ["TX"], call_phone: "+12145550100", ad_domain: "book.lonestar.com", ad_domain_ok: true } as unknown as Agent;
const base = { customerId: "1234567890", agent, brand: null, monthlyCapCents: 150_000, callConversion: null, landingUrl: "https://book.lonestar.com/", landingFor: (k: string) => `https://book.lonestar.com/${k}` };
const adsIn = (ops: ReturnType<typeof campaignOperations>["ops"]) => ops.filter((o) => "adGroupAdOperation" in o).map((o) => (o as { adGroupAdOperation: { create: { adGroup: string; status: string; ad: { finalUrls: string[]; responsiveSearchAd: { headlines: { text: string }[] } } } } }).adGroupAdOperation.create);
const plain = campaignOperations(base);
const withResearch = campaignOperations({ ...base, alsoRsa: kept });
const groups = plain.groups.length;
assert.ok(groups >= 3, "replacement, repair and storm with no job rules");
assert.equal(adsIn(plain.ops).length, groups, "one ad per group without research");
const ads = adsIn(withResearch.ops);
assert.equal(ads.length, groups * 2, "two ads per group with research");
assert.ok(ads.every((a) => a.status === "ENABLED"), "both ads go live with the campaign");
assert.equal(ads.filter((a) => a.ad.responsiveSearchAd.headlines[0].text === "Headline 1").length, groups, "the winning ad is in every group");
for (const g of new Set(ads.map((a) => a.adGroup))) {
  const urls = new Set(ads.filter((a) => a.adGroup === g).map((a) => a.ad.finalUrls[0]));
  assert.equal(urls.size, 1, "both ads in a group land on that group's page");
  assert.match([...urls][0], /^https:\/\/book\.lonestar\.com\/[a-z-]+$/, "on the client's own domain");
}
assert.equal(adsIn(campaignOperations({ ...base, rsa: kept, alsoRsa: kept }).ops).length, groups, "rsa (publish) replaces, never doubles");

console.log("research → live campaign: ok");

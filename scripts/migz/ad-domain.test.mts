// Run: NODE_PATH=scripts/migz/stubs TSX_TSCONFIG_PATH=./tsconfig.json node --import tsx scripts/migz/ad-domain.test.mts
import assert from "node:assert/strict";
import { cleanAdDomain, isOurHost } from "../../src/lib/booking/ad-domain.ts";
import { adLinkFor } from "../../src/lib/booking/sites.ts";

// A pasted address becomes a bare host; it must be a subdomain on their own domain
assert.deepEqual(cleanAdDomain(" https://Book.MartinezRoofing.com/free-inspection?x=1 "), { ok: true, domain: "book.martinezroofing.com" });
assert.deepEqual(cleanAdDomain("book.martinezroofing.com."), { ok: true, domain: "book.martinezroofing.com" });
assert.equal(cleanAdDomain("martinezroofing.com").ok, false, "a bare domain stays on their website");
assert.equal(cleanAdDomain("").ok, false);
assert.equal(cleanAdDomain("not a domain").ok, false);
assert.equal(cleanAdDomain("book.anryhlabs.com").ok, false, "never our domain");
assert.equal(cleanAdDomain("x.vercel.app").ok, false);

// Our own hosts are never a roofer's ad address
assert.equal(isOurHost("anryhlabs.com"), true);
assert.equal(isOurHost("www.anryhlabs.com"), true);
assert.equal(isOurHost("localhost:3000"), true);
assert.equal(isOurHost("anryh-abc123.vercel.app"), true);
assert.equal(isOurHost("book.martinezroofing.com"), false);
assert.equal(isOurHost("book.martinezroofing.com", "https://app.example.com"), false);
assert.equal(isOurHost("app.example.com", "https://app.example.com"), true);

// Ads use the roofer's own domain only once it's live
const a = { slug: "martinez", ad_domain: "book.martinezroofing.com" };
assert.equal(adLinkFor({ ...a, ad_domain_ok: true }, "https://anryhlabs.com"), "https://book.martinezroofing.com/");
assert.equal(adLinkFor({ ...a, ad_domain_ok: false }, "https://anryhlabs.com"), "https://anryhlabs.com/martinez");
assert.equal(adLinkFor({ slug: "martinez" }, "https://anryhlabs.com"), "https://anryhlabs.com/martinez");
assert.equal(adLinkFor({ ...a, ad_domain_ok: true, booking_choice: "own", own_booking_url: "https://martinezroofing.com/book" }, "https://anryhlabs.com"), "https://martinezroofing.com/book", "their own booking page wins");

console.log("ad-domain: ok");

// ---------- Landing pages per ad group ----------
const { landingPageUrl, groupKeyFromName, rootDomainOf, LANDING_GROUPS } = await import("../../src/lib/landing/groups.ts");
const { landingCopy } = await import("../../src/lib/landing/copy.ts");
const live = { slug: "martinez", ad_domain: "book.martinezroofing.com", ad_domain_ok: true };
assert.equal(landingPageUrl(live, "replacement", "https://anryhlabs.com"), "https://book.martinezroofing.com/roof-replacement");
assert.equal(landingPageUrl(live, "storm", "https://anryhlabs.com"), "https://book.martinezroofing.com/storm-damage");
assert.equal(landingPageUrl({ ...live, ad_domain_ok: false }, "repair", "https://anryhlabs.com"), "https://anryhlabs.com/martinez/p/roof-repair");
assert.equal(landingPageUrl(live, null, "https://anryhlabs.com"), "https://book.martinezroofing.com/", "an unknown group gets the booking page");
assert.equal(landingPageUrl({ ...live, booking_choice: "own", own_booking_url: "https://martinezroofing.com/book" }, "repair"), "https://martinezroofing.com/book");
assert.equal(groupKeyFromName("Roof replacement"), "replacement");
assert.equal(groupKeyFromName(" storm and hail damage "), "storm");
assert.equal(groupKeyFromName("Brand terms"), null);
assert.equal(rootDomainOf("https://www.MartinezRoofing.com/about"), "martinezroofing.com");
assert.equal(rootDomainOf("martinezroofing.com"), "martinezroofing.com");
assert.equal(rootDomainOf(""), null);

const facts = { company: "Martinez Roofing", city: "Bothell", area: "within 15 miles of Bothell, WA", offer: "inspection" as const, special: "$1,000 Off a Full Roof", certification: "GAF Master Elite", warranty: "Lifetime workmanship warranty", license: "MARTIRC812KD", emergencies: true };
for (const g of LANDING_GROUPS) {
  const c = landingCopy(g.key, { headline: "Roof Replacement Bothell", description: "Full roof replacements by a local crew." }, facts);
  assert.equal(c.title, "Roof Replacement Bothell", "the page says what the ad said");
  const all = JSON.stringify(c).toLowerCase();
  assert.ok(!/free (new )?roof(?! inspection)/.test(all), `${g.key}: promises a free roof`);
  for (const banned of ["deductible", "financing", "insurance will pay", "guaranteed approval"]) assert.ok(!all.includes(banned), `${g.key}: ${banned}`);
  assert.ok(c.why.includes("GAF Master Elite") && c.why.includes("License #MARTIRC812KD"));
}
assert.ok(landingCopy("storm", { headline: "x", description: "y" }, facts).faq.some((f) => /can't promise/.test(f.a)), "storm page never promises an insurance outcome");
assert.equal(landingCopy("repair", { headline: "x", description: "y" }, { ...facts, license: "WA Lic #MARTIRC812KD" }).why.includes("WA Lic #MARTIRC812KD"), true, "a written-out license isn't doubled");
const { fitDescription } = await import("../../src/lib/google-ads/playbook.ts");
assert.equal(fitDescription("Full roof replacements by a local crew. Book your free roof inspection online in under a minute."), "Full roof replacements by a local crew.");
assert.equal(fitDescription("Short and sweet."), "Short and sweet.");
console.log("landing pages: ok");

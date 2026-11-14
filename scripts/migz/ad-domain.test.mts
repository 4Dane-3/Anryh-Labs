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

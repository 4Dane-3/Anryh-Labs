// Run: NODE_PATH=scripts/migz/stubs TSX_TSCONFIG_PATH=./tsconfig.json node --import tsx scripts/migz/roofer-setup.test.mts
import assert from "node:assert/strict";
import { promotes, specialCheckDue, specialEmail, specialMarkers } from "../../src/lib/roofing/special-rules.ts";
import { leadOffer, SPECIALS, CERTIFICATIONS, WARRANTIES } from "../../src/lib/roofing/setup-options.ts";
import { MIGZ_ROOFING_QUOTE_SYSTEM_PROMPT, MIGZ_ROOFING_SYSTEM_PROMPT, quoteVariant, systemPromptFor } from "../../src/lib/migz/prompt.ts";
import { roofingCopyProblem } from "../../src/lib/verticals.ts";

const DAY = 86_400_000;
const now = Date.parse("2026-11-11T12:00:00Z");
const ago = (d: number) => new Date(now - d * DAY).toISOString();

// Weekly: due only with a special, and not asked or confirmed in the last 7 days
assert.equal(specialCheckDue({ deals: [], special_asked_at: null, special_confirmed_at: null }, now), false);
assert.equal(specialCheckDue({ deals: ["$500 off"], special_asked_at: null, special_confirmed_at: null }, now), true);
assert.equal(specialCheckDue({ deals: ["$500 off"], special_asked_at: ago(3), special_confirmed_at: null }, now), false);
assert.equal(specialCheckDue({ deals: ["$500 off"], special_asked_at: ago(8), special_confirmed_at: ago(2) }, now), false);
assert.equal(specialCheckDue({ deals: ["$500 off"], special_asked_at: ago(8), special_confirmed_at: ago(9) }, now), true);

// Which ads promote a special: by its amounts, else its long words
assert.deepEqual(specialMarkers("$500 off a full roof replacement"), ["$500"]);
assert.deepEqual(specialMarkers("Free gutter guards with a new roof"), ["gutter", "guards"]);
assert.ok(promotes("Kenmore homeowners: $ 500 off a new roof this month", specialMarkers("$500 off a full roof replacement")));
assert.ok(!promotes("$1,000 off a new roof", specialMarkers("$500 off a full roof replacement")));
assert.ok(promotes("Free Gutter Guards with every new roof", specialMarkers("Free gutter guards with a new roof")));
assert.ok(!promotes("anything", []));
const mail = specialEmail({ full_name: "Summit <Roofing>" }, "$500 off");
assert.ok(mail.html.includes("Summit &lt;Roofing&gt;") && mail.html.includes("?answer=yes") && mail.html.includes("?answer=ended"));

// Lead goal: the copy offers a free quote instead of an inspection
assert.equal(leadOffer({ lead_goal: "quote" }).short, "free quote");
assert.equal(leadOffer({ lead_goal: null }).short, "free roof inspection");
assert.equal(systemPromptFor("roofing", "quote"), MIGZ_ROOFING_QUOTE_SYSTEM_PROMPT);
assert.equal(systemPromptFor("roofing", "inspection"), MIGZ_ROOFING_SYSTEM_PROMPT);
assert.ok(!/free (roof )?inspection/i.test(MIGZ_ROOFING_QUOTE_SYSTEM_PROMPT), "quote prompt still offers an inspection");
assert.ok(MIGZ_ROOFING_QUOTE_SYSTEM_PROMPT.includes("free quote"));
assert.equal(quoteVariant("Book a free inspection."), "Get a free quote.");

// Every preset passes the roofing copy rules
for (const t of [...SPECIALS, ...WARRANTIES, ...CERTIFICATIONS.flatMap((g) => g.tiers)]) assert.equal(roofingCopyProblem(t), null, t);

console.log("roofer setup: all passed");

// Kling takes 6 shots at most: a 7-shot brief keeps its first 5 and merges the rest into the last
const { klingShots, KLING_MAX_SHOTS } = await import("../../src/lib/higgsfield.ts");
const seven = Array.from({ length: 7 }, (_, i) => ({ prompt: `Shot ${i + 1} action. Same people: crew. Candid.`, duration: i === 6 ? 3 : 2 }));
const fitted = klingShots(seven);
assert.equal(fitted.length, KLING_MAX_SHOTS);
assert.equal(fitted.reduce((n, s) => n + s.duration, 0), 15);
assert.ok(fitted[5].prompt.startsWith("Shot 6 action Then: Shot 7 action") && fitted[5].prompt.includes("Same people: crew"), fitted[5].prompt);
assert.equal(klingShots(seven.slice(0, 6)).length, 6);
console.log("kling shots: passed");

// Their photos and clips: one of each kind first, real clips before photos, at most 3 photos, different per video
{
  const { allMedia, pickBroll, kindsForWord, motionFor } = await import("../../src/lib/roofing/job-media.ts");
  const m = (kind: string, type: "photo" | "video", n: number) => ({ path: `a/${kind}-${type}-${n}`, kind, type }) as Parameters<typeof pickBroll>[0][number];
  const media = [m("crew", "photo", 1), m("crew", "video", 1), m("inspection", "photo", 1), m("damage", "photo", 1), m("finished", "photo", 1), m("drone", "video", 1)];
  const picked = pickBroll(media, 0);
  assert.equal(picked[0].path, "a/crew-video-1", "a real clip before a photo");
  assert.equal(new Set(picked.map((p) => p.kind)).size, picked.length, "one of each kind");
  assert.ok(picked.filter((p) => p.type === "photo").length <= 3);
  assert.ok(picked.length <= 4);
  const crews = [m("crew", "photo", 1), m("crew", "photo", 2), m("crew", "photo", 3)];
  assert.notEqual(pickBroll(crews, 0)[0].path, pickBroll(crews, 1)[0].path, "different picks per video");
  assert.equal(pickBroll(crews, 0).length, 3);
  assert.deepEqual(pickBroll([], 3), []);
  assert.deepEqual(allMedia([m("crew", "photo", 1)], ["a/old", "a/crew-photo-1"]).map((x) => x.kind), ["crew", "other"]);
  assert.deepEqual(kindsForWord("Inspection,"), ["inspection", "damage"]);
  assert.deepEqual(kindsForWord("leaks"), ["damage", "inspection"]);
  assert.deepEqual(kindsForWord("Bothell"), []);
  assert.ok(motionFor("crew").includes("Nothing is added"));
  console.log("job media: passed");
}

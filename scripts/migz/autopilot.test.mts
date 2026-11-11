// Run: node --import tsx scripts/migz/autopilot.test.mts
import assert from "node:assert/strict";
import { parseCommand } from "../../src/lib/migz/chat-rules.ts";
import { normalizeUsPhone, twilioSignature, validTwilioSignature } from "../../src/lib/migz/sms.ts";
import { brollShots, brollTimes, captions, cardTimes, overlayFilter, sfxEvents, wordsFromChars } from "../../src/lib/migz/presenter-plan.ts";
import { depositFor, feeCents, feeLabel, feePlanOf } from "../../src/lib/campaign.ts";
import { roofingCopyProblem } from "../../src/lib/verticals.ts";
import { mergeRevision, parseJson } from "../../src/lib/migz/video-revise-merge.ts";

// Approving only on the exact words
for (const t of ["APPROVE", "approve.", " Approve all ", "approved!"]) assert.equal(parseCommand(t), "approve", t);
for (const t of ["don't approve", "approve if you think so", "not approved", "yes", "looks good"]) assert.equal(parseCommand(t), null, t);
assert.equal(parseCommand("STOP"), "stop");
assert.equal(parseCommand("start"), "start");

// Phones and signatures
assert.equal(normalizeUsPhone("(425) 555-0199"), "+14255550199");
assert.equal(normalizeUsPhone("1 425 555 0199"), "+14255550199");
assert.equal(normalizeUsPhone("555-0199"), null);
const params = { From: "+14255550199", Body: "hi" };
const sig = twilioSignature("secret", "https://x.test/hook", params);
assert.ok(validTwilioSignature("secret", "https://x.test/hook", params, sig));
assert.ok(!validTwilioSignature("other", "https://x.test/hook", params, sig));
assert.ok(!validTwilioSignature("secret", "https://x.test/hook", { ...params, Body: "APPROVE" }, sig));

// B-roll: only their real job photos, at most three
assert.deepEqual(brollShots(["j1", "j2", "j3", "j4"]).map((b) => b.path), ["j1", "j2", "j3"]);
assert.deepEqual(brollShots([]), []);

// Captions
const text = "Are you planning, on a new roof";
const chars = [...text];
const words = wordsFromChars(chars, chars.map((_, i) => i * 0.05), chars.map((_, i) => i * 0.05 + 0.05));
assert.deepEqual(words.map((w) => w.word), text.split(" "));
const caps = captions(words);
assert.equal(caps.map((c) => c.text).join(" "), text);
assert.ok(caps.every((c) => c.text.split(" ").length <= 4));
assert.equal(caps[0].emphasis, "planning,");
for (let i = 1; i < caps.length; i++) assert.ok(caps[i - 1].end <= caps[i].start + 1e-9, "captions don't overlap");

// Cards: callout first, then towns; offer and badge only when given; CTA always last
assert.deepEqual(cardTimes(25, { towns: [], offer: null, badge: null }).map((c) => c.kind), ["cta"]);
const all = cardTimes(25, { callout: "Kenmore homeowners", towns: ["Kenmore"], offer: "$500 off", badge: "CertainTeed ShingleMaster" });
assert.deepEqual(all.map((c) => c.kind), ["callout", "towns", "offer", "badge", "cta"]);
assert.equal(all[0].start, 0, "the hook is on the first frame");
assert.equal(all.at(-1)!.end, 25);
for (let i = 1; i < all.length; i++) assert.ok(all[i - 1].end <= all[i].start, "cards never overlap");
assert.deepEqual(cardTimes(13, { towns: [], offer: "$500 off", badge: "ShingleMaster" }).map((c) => c.kind), ["offer", "cta"], "a short video drops the badge");
assert.equal(overlayFilter([{ start: 0, end: 1 }, { start: 1, end: 2 }]).out, "[v2]");
assert.ok(overlayFilter([{ start: 0, end: 1 }], "cut1", 3).filter.startsWith("[cut1][3:v]"));

// Cut-aways: in the middle, never in the hook or over the last card, never overlapping
const cuts = brollTimes(25, 3);
assert.equal(cuts.length, 3);
assert.ok(cuts[0].start >= 5 && cuts.at(-1)!.end <= 25 - 3.5);
for (let i = 1; i < cuts.length; i++) assert.ok(cuts[i - 1].end < cuts[i].start);
assert.ok(brollTimes(9, 3).length < 3, "a short video takes fewer cut-aways");

// Sound: a hit on frame one, whooshes on cards and cuts, pops on captions that aren't on top of a whoosh
const fx = sfxEvents(all, caps, cuts);
assert.deepEqual(fx[0], { kind: "hit", at: 0 });
assert.equal(fx.filter((e) => e.kind === "whoosh").length, all.length - 1 + cuts.length);
for (const p of fx.filter((e) => e.kind === "pop")) assert.ok(!fx.some((e) => e.kind !== "pop" && Math.abs(e.at - p.at) < 0.3));

// Hooks call out the town and the house, never the person
for (const t of ["Seniors in Kenmore", "homeowners 60+", "over 60 and need a roof?"]) assert.ok(roofingCopyProblem(t), t);
for (const t of ["Kenmore homeowners", "If your roof is 15+ years old", "Over 50 years in business", "CertainTeed ShingleMaster roofer"]) assert.equal(roofingCopyProblem(t), null, t);

// Migz AI by the month: no fee on ad funds
assert.equal(feePlanOf({ migz_plan: "subscription" }), "subscription");
assert.equal(feePlanOf({}), "percent");
assert.equal(feeCents(100_000, 0, "subscription"), 0);
assert.equal(feeCents(100_000), 20_000);
assert.equal(depositFor(80_000, 0, "subscription"), 80_000);
assert.equal(depositFor(80_000), 100_000);
assert.match(feeLabel(100_000, 0, "subscription"), /no fee/);

// Remakes keep the structure and the system's fields
const brief = { concept: "c", style: "s", hook_line: "h", hook_shot: "hs", body_shots: [{ prompt: "p", duration: 2 }], primary_text: "t", headline: "hl", presenter: { mode: "ai" as const, script: "old", callout: "Kenmore homeowners", towns: ["Kenmore"], photo_paths: ["a"], job_paths: [] } };
const m = mergeRevision(brief, { headline: "new", body_shots: [{ prompt: "q", duration: 99 }], presenter: { script: "new script", callout: "Bothell homeowners with older roofs", photo_paths: ["stolen"] } });
assert.equal(m.presenter!.callout, "Bothell homeowners with older", "a callout stays 4 words");
assert.equal(m.headline, "new");
assert.equal(m.body_shots[0].duration, 2, "duration can't change");
assert.equal(m.presenter!.script, "new script");
assert.deepEqual(m.presenter!.photo_paths, ["a"], "photos can't change");
assert.equal(m.primary_text, "t");
assert.equal(parseJson('text {"a":1} more').a, 1);

console.log("autopilot checks passed");

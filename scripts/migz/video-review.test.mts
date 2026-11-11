// Run: node --import tsx scripts/migz/video-review.test.mts
import assert from "node:assert/strict";
import { reviewEmail, reviewSlack, shouldAsk, shouldNudge, WAIT_FOR_BATCH_MS, NUDGE_AFTER_MS } from "../../src/lib/migz/video-review-copy.ts";

const now = Date.parse("2026-11-10T20:00:00Z");
const ago = (ms: number) => new Date(now - ms).toISOString();
const video = (ready: number, asked: number | null = null, nudged: number | null = null) => ({
  approval_ready_at: ago(ready),
  approval_requested_at: asked === null ? null : ago(asked),
  approval_nudged_at: nudged === null ? null : ago(nudged),
});

// Asking
assert.equal(shouldAsk([], false, now), false, "nothing waiting");
assert.equal(shouldAsk([video(1000)], false, now), true, "batch finished: ask now");
assert.equal(shouldAsk([video(1000)], true, now), false, "others still being made: hold");
assert.equal(shouldAsk([video(WAIT_FOR_BATCH_MS)], true, now), true, "held an hour: ask anyway");
assert.equal(shouldAsk([video(5000, 1000)], false, now), false, "already asked");
assert.equal(shouldAsk([video(5000, 1000), video(100)], false, now), true, "a newer video still gets asked about");

// Nudging
assert.equal(shouldNudge([video(5000, 1000)], now), false, "too soon");
assert.equal(shouldNudge([video(NUDGE_AFTER_MS + 1, NUDGE_AFTER_MS)], now), true, "two days on");
assert.equal(shouldNudge([video(NUDGE_AFTER_MS + 2, NUDGE_AFTER_MS + 1, 100)], now), false, "only once");
assert.equal(shouldNudge([video(1000)], now), false, "never asked");

// Copy
const url = "https://example.test/review/abc";
const one = reviewEmail({ name: "Sam Rivera", count: 1, url, nudge: false });
assert.match(one.subject, /Your new video is ready/);
assert.match(one.text, /Hi Sam,/);
assert.match(one.text, /Nothing goes live until you do/);
assert.ok(one.html.includes(url));
const many = reviewEmail({ name: "Sam", count: 3, url, nudge: false });
assert.match(many.subject, /Your 3 new videos are ready/);
const nudge = reviewEmail({ name: "Sam", count: 2, url, nudge: true });
assert.match(nudge.subject, /Still waiting on your OK: 2 videos/);
assert.ok(reviewEmail({ name: "<b>", count: 1, url, nudge: false }).html.includes("&lt;b&gt;"), "names are escaped");
const slack = reviewSlack({ count: 2, url, nudge: false });
assert.match(slack.text, /2 new videos are ready/);
assert.equal((slack.blocks[1] as { elements: { url: string }[] }).elements[0].url, url);

console.log("video review checks passed");

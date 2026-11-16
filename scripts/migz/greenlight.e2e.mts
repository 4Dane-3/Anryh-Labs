// Greenlight to live, end to end: a roofer turns Google on, and everything from competitor research to the lead
// reaching Google as a conversion. Runs against a dev server and the Supabase project in .env.local.
// Nothing reaches Google or Meta, and nobody is called:
//   - The Google campaign is built as the exact operations Migz would send, not sent (the developer token can't
//     touch real accounts yet). Ads are checked, and every final URL is opened on the dev server.
//   - The dev server must run with calls simulated (no VOICE_LIVE_CALLS) and Meta switched off, like the
//     "roofer-setup-preview" launch config. Phone numbers are fictional 555-01xx.
//   - Creates a throwaway roofer (e2e-greenlight-*) and deletes it and everything it made.
//
//   BASE=http://localhost:3008 NODE_PATH=scripts/migz/stubs TSX_TSCONFIG_PATH=./tsconfig.json \
//     node --env-file=.env.local --import tsx scripts/migz/greenlight.e2e.mts
(globalThis as { WebSocket?: unknown }).WebSocket ??= class {}; // supabase-js wants one on Node 20
import assert from "node:assert/strict";
import { request } from "node:http";
import { supabaseAdmin as db } from "@/lib/supabase-admin";
import type { Agent } from "@/lib/booking/data";
import { adLinkFor } from "@/lib/booking/sites";
import { refreshAdDomain } from "@/lib/booking/ad-domain-server";
import { campaignOperations, planFacts } from "@/lib/google-ads/build";
import { adGroupPlans } from "@/lib/google-ads/playbook";
import { checkAdText } from "@/lib/google-ads/guardrails";
import { conversionFor, fromGoogle } from "@/lib/google-ads/conversions";
import { landingPageUrl } from "@/lib/landing/groups";
import { researchAd, researchLanding, researchState } from "@/lib/competitors/live";
import { firstBuildStep, talksBooking } from "@/lib/competitors/live-copy";

const BASE = new URL(process.env.BASE || "http://localhost:3008");
const ok = (m: string) => console.log(`  ✓ ${m}`);
const tag = Date.now().toString(36);
const slug = `e2e-greenlight-${tag}`;
const domain = `book.e2e-${tag}.test`;
const PHONE = `+1214555${String(100 + (Date.now() % 90)).padStart(4, "0")}`; // 555-01xx: fictional

/** A request to the dev server as if it came to the roofer's own domain (the proxy routes by host). */
function onDomain(path: string, init: { method?: string; body?: unknown } = {}): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const body = init.body === undefined ? undefined : JSON.stringify(init.body);
    const req = request(
      { host: BASE.hostname, port: BASE.port, path, method: init.method ?? "GET", headers: { host: domain, ...(body ? { "content-type": "application/json", "content-length": Buffer.byteLength(body) } : {}) } },
      (res) => {
        let text = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (text += c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, text }));
      },
    );
    req.on("error", reject);
    req.setTimeout(120_000, () => req.destroy(new Error(`timed out: ${path}`)));
    if (body) req.write(body);
    req.end();
  });
}
const visible = (html: string) => html.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<style[\s\S]*?<\/style>/g, " ").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ");

// The research a finished run leaves behind: an ad that passed the 9/10 gate and a landing page that beat every
// competitor page. One section and the CTA still say "book", from before the quote request: they must not show.
const research = {
  headlines: ["Roof Replacement in Plano", "Free Roof Inspection", "GAF Master Elite Roofer", "Photos of Every Problem", "Written Price Up Front", "Lifetime Shingle Warranty", "Local Plano Crew", "No Pressure, Ever", "Licensed and Insured", "We Call You Right Back", "Storm Damage Checked", "Honest Repair or Replace", "Request a Free Quote", "Clear Price in Writing", "Plano Homes Since 2009"],
  descriptions: ["A GAF Master Elite crew checks your whole roof and shows you photos of every problem.", "Request a free quote and we call you right back with a few quick questions.", "A written price before any work, and honest advice on repair or replace.", "Backed by a lifetime shingle warranty. Local to Plano, licensed and insured."],
  path1: "roofing",
  path2: "plano",
};
const landing = {
  headline: "Book your free roof inspection",
  subhead: "A GAF Master Elite crew that shows you photos of every problem before you decide anything.",
  offer: "Free roof inspection with photos",
  proof: ["GAF Master Elite contractor", "Lifetime shingle warranty", "Book online 24/7"],
  sections: [
    { title: "Photos of every problem", body: "Most roofers tell you what's wrong. We show you, with photos of every shingle, vent and flashing we check." },
    { title: "Book in under a minute", body: "Pick a time that suits you." },
    { title: "A written price first", body: "You get the price in writing before any work starts. Book online today. No surprises on the invoice." },
  ],
  cta: "Book my free inspection",
  versus: [
    { url: "https://competitor-a.example", confidence: 9, why: "Ours shows proof, theirs only claims it." },
    { url: "https://competitor-b.example", confidence: 10, why: "Theirs never says what the inspection covers." },
  ],
};

let agentId: string | null = null;
try {
  // ---------- 0. The dev server ----------
  const ping = await fetch(new URL("/api/version", BASE)).catch(() => null);
  assert.ok(ping, `the dev server isn't running at ${BASE}`);
  ok(`dev server at ${BASE.origin}`);

  // ---------- 1. A roofer who just gave the green light ----------
  const zones = ["America/Chicago", "America/New_York", "America/Denver", "America/Los_Angeles", "Pacific/Honolulu", "Europe/London", "Asia/Tokyo", "Australia/Sydney"];
  const hourIn = (tz: string) => Number(new Intl.DateTimeFormat("en-US", { hour: "numeric", hourCycle: "h23", timeZone: tz }).format(new Date()));
  const tz = zones.find((z) => hourIn(z) >= 9 && hourIn(z) <= 18) ?? "America/Chicago";
  const { data: row, error } = await db
    .from("agents")
    .insert({ slug, full_name: `E2E Greenlight Roofing ${tag}`, email: `${slug}@example.com`, active: true, vertical: "roofing", timezone: tz, voice_agent: true, service_area: "Plano, TX", licensed_states: ["TX"], service_radius_miles: 25, min_notice_hours: 1, buffer_minutes: 30, slot_minutes: 60, onboarding_completed_at: new Date().toISOString(), ad_domain: domain, ad_domain_ok: true })
    .select("*")
    .single();
  if (error) throw error;
  agentId = row.id as string;
  const agent = row as Agent;
  await db.from("availability_rules").insert([1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ agent_id: agentId, weekday, start_time: "08:00", end_time: "18:00" })));
  const { error: brandErr } = await db.from("agent_brand").insert({ agent_id: agentId, website: `https://e2e-${tag}.test`, accent: "#c2410c", background: "#0f172a", text_color: "#0f172a", certifications: ["GAF Master Elite"], warranties: ["Lifetime shingle warranty"], deals: [], license: "TX Lic #E2E123", proof: { rating: 4.9, reviews: 212, stats: [{ value: "1,840", label: "Plano roofs since 2009" }] } });
  if (brandErr) throw brandErr;
  const { error: gErr } = await db.from("google_ads_accounts").insert({ agent_id: agentId, customer_id: "1234567890", link_status: "created", enabled: true, monthly_cap_cents: 150_000 });
  if (gErr) throw gErr;
  ok(`throwaway roofer ${slug}: Google on, $1,500/month cap, ad address ${domain} live`);

  // ---------- 2. Research: started on the green light, the first build waits for it ----------
  assert.equal(firstBuildStep(await researchState(agentId), true), "start", "no research yet: the green light starts it");
  const { data: run, error: runErr } = await db.from("competitor_runs").insert({ agent_id: agentId, markets: [], budget_usd: 1, status: "running", stage: "write", log: [] }).select("id").single();
  if (runErr) throw runErr;
  assert.equal(firstBuildStep(await researchState(agentId), true), "wait", "running: the build waits");
  assert.equal(await researchAd(agentId), null, "nothing to use while it runs");
  await db
    .from("competitor_runs")
    .update({
      status: "done",
      stage: "done",
      finished_at: new Date().toISOString(),
      drafts: { headlines: [], descriptions: [], kept: research, counts: { written: 150, rules: 61, buyer: 24, variety: 15, kept: 15 }, matchups: [], landing, verdict: { publishable: true, minConfidence: 9, why: "At least 9/10 sure ours beats every winning competitor ad." }, writtenAt: new Date().toISOString() },
    })
    .eq("id", run.id);
  assert.equal(firstBuildStep(await researchState(agentId), true), "build", "done: the build goes ahead");
  const ad = await researchAd(agentId);
  assert.deepEqual(ad, research, "the ad that passed the 9/10 gate");
  assert.equal(checkAdText(ad!.headlines, ad!.descriptions, ad!.path1, ad!.path2), null, "within Google's rules");
  const lp = await researchLanding(agentId);
  assert.ok(lp && lp.confidence === 9);
  ok(`research: green light starts it, the build waits while it runs, then uses its ad (15 headlines, 4 descriptions) and landing copy (9/10 against ${landing.versus.length} competitor pages)`);

  // ---------- 3. The campaign Migz builds ----------
  const facts = planFacts(agent, { deals: [], certifications: ["GAF Master Elite"], warranties: ["Lifetime shingle warranty"] });
  const plans = adGroupPlans(facts);
  const { ops, groups } = campaignOperations({ customerId: "1234567890", agent, brand: { deals: [], certifications: ["GAF Master Elite"], warranties: ["Lifetime shingle warranty"] } as never, monthlyCapCents: 150_000, callConversion: null, landingUrl: adLinkFor(agent, process.env.APP_URL), landingFor: (k) => landingPageUrl(agent, k), alsoRsa: ad });
  type AdOp = { adGroupAdOperation: { create: { adGroup: string; status: string; ad: { finalUrls: string[]; responsiveSearchAd: { headlines: { text: string }[]; descriptions: { text: string }[] } } } } };
  const ads = ops.filter((o): o is AdOp => "adGroupAdOperation" in o).map((o) => o.adGroupAdOperation.create);
  const campaign = ops.find((o) => "campaignOperation" in o) as { campaignOperation: { create: { status: string; networkSettings: Record<string, boolean> } } };
  assert.equal(campaign.campaignOperation.create.status, "ENABLED", "the campaign goes live, not paused");
  assert.equal(campaign.campaignOperation.create.networkSettings.targetContentNetwork, false);
  assert.equal(ads.length, groups.length * 2, "every ad group: its own ad and the winning ad");
  assert.ok(ads.every((a) => a.status === "ENABLED"));
  for (const a of ads) {
    const text = [...a.ad.responsiveSearchAd.headlines, ...a.ad.responsiveSearchAd.descriptions].map((x) => x.text);
    const booking = text.filter(talksBooking);
    assert.deepEqual(booking, [], `an ad still promises booking: ${booking.join(" | ")}`);
    assert.match(a.ad.finalUrls[0], new RegExp(`^https://${domain.replace(/\./g, "\\.")}/[a-z-]+$`), "lands on the client's own domain");
  }
  ok(`campaign: ${groups.length} ad groups (${plans.map((p) => p.key).join(", ")}), 2 live ads each, all asking for a quote, all on https://${domain}`);

  // ---------- 4. Every page an ad lands on ----------
  for (const p of plans) {
    const url = new URL(landingPageUrl(agent, p.key));
    const res = await onDomain(url.pathname + "?gclid=e2e-click&utm_source=google");
    assert.equal(res.status, 200, `${url} → ${res.status}`);
    const text = visible(res.text);
    assert.ok(text.includes(p.headlines[0]), `${url}: the headline matches the ad group (${p.headlines[0]})`);
    assert.ok(text.includes(landing.subhead), `${url}: research subhead`);
    assert.ok(text.includes("Photos of every problem") && text.includes("A written price first"), `${url}: research sections`);
    assert.ok(text.includes("You get the price in writing before any work starts. No surprises on the invoice."), `${url}: booking sentence dropped from a research section`);
    assert.ok(!text.includes("Book in under a minute") && !text.includes("Book my free inspection") && !text.includes("Book online"), `${url}: no booking copy`);
    assert.ok(text.includes("Get your free quote") && text.includes("Yes, send my quote request"), `${url}: the quote form`);
    assert.ok(text.includes("4.9") && text.includes("Google reviews"), `${url}: Google review badge`);
    assert.ok(!text.includes("Visitors see nothing here"), `${url}: no placeholders for visitors`);
    assert.ok(/noindex/.test(res.text), `${url}: kept out of search engines`);
    ok(`${url.href}: 200, "${p.headlines[0]}", research copy, quote form, review badge, no booking copy`);
  }

  // ---------- 5. Meta ads: the client's domain too ----------
  const metaLink = adLinkFor(agent, process.env.APP_URL);
  assert.equal(metaLink, `https://${domain}/`, "Meta ads link the client's domain");
  const home = await onDomain("/?fbclid=e2e");
  assert.equal(home.status, 200);
  assert.ok(visible(home.text).includes(agent.full_name));
  ok(`Meta ads link ${metaLink}: 200, their booking page`);

  // ---------- 6. A homeowner from a Google ad requests a quote ----------
  const t0 = Date.now();
  const quote = await onDomain("/api/quotes", { method: "POST", body: { slug, name: "E2E Homeowner", phone: PHONE, consent: true, address: "1420 Oak St", city: "Plano", roofIssue: "It's old, thinking about replacing", timezone: tz, attribution: { gclid: "e2e-click", utm_source: "google", utm_medium: "cpc" } } });
  const qBody = JSON.parse(quote.text);
  assert.equal(quote.status, 200, quote.text);
  await new Promise((r) => setTimeout(r, 2000)); // the after() writes
  const { data: lead } = await db.from("quote_requests").select("id, attribution, voice_status, roof_issue").eq("agent_id", agentId).single();
  assert.equal(lead!.attribution?.gclid, "e2e-click", "the click id is kept with the lead");
  if (qBody.voice?.status === "calling") {
    assert.equal(lead!.voice_status, "calling");
    const { data: call } = await db.from("voice_calls").select("reason").eq("lead_id", lead!.id).single();
    assert.equal(call?.reason, "instant");
    ok(`quote request saved with the gclid, Emma's call requested at once (${Date.now() - t0}ms round trip, simulated)`);
  } else {
    ok(`quote request saved with the gclid (Emma ${qBody.voice ? qBody.voice.status : "off on this server: no ElevenLabs keys"})`);
  }

  // ---------- 7. Emma books the inspection → Google gets the conversion ----------
  const secret = process.env.ELEVENLABS_WEBHOOK_SECRET;
  if (secret && qBody.voice) {
    const tool = (name: string, body: unknown) => fetch(new URL(`/api/voice/tools/${name}`, BASE), { method: "POST", headers: { "content-type": "application/json", "x-voice-secret": secret }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, body: await r.json() }));
    const times = await tool("open_times", { lead_id: lead!.id });
    assert.ok(times.body.times?.length, JSON.stringify(times.body));
    const booked = await tool("book_inspection", { lead_id: lead!.id, start: times.body.times[0].start, owns_home: "Yes", roof_type: "shingle" });
    assert.equal(booked.status, 200, JSON.stringify(booked.body));
    const { data: booking } = await db.from("bookings").select("id, email, phone, created_at, job_done_at, attribution").eq("agent_id", agentId).single();
    assert.ok(fromGoogle(booking!.attribution), "the booking counts as from Google");
    const conv = conversionFor(booking as never, "customers/1234567890/conversionActions/1", booking!.created_at, null);
    assert.equal((conv as { gclid?: string }).gclid, "e2e-click", "the conversion Google gets carries the click id");
    ok(`Emma books ${times.body.times[0].label}: the booking keeps the gclid, and the "Booked inspection" conversion is ready for Google`);
  } else {
    console.log("  - skipped Emma's booking step (needs the voice agent on the server and ELEVENLABS_WEBHOOK_SECRET)");
  }

  // ---------- 8. Ad address checked on its own ----------
  const check = await refreshAdDomain({ id: agentId, ad_domain: `not-pointing-${tag}.test`, ad_domain_ok: false });
  assert.deepEqual(check, { live: false, pointing: false }, "an address that doesn't point at us stays off");
  ok("ad address re-check: a domain that doesn't point at us is not marked live");

  // ---------- 9. Before research, or when it loses: the playbook's copy, never a broken page ----------
  await db.from("competitor_runs").update({ drafts: { headlines: [], descriptions: [], kept: research, counts: { written: 150, rules: 40, buyer: 9, variety: 9, kept: 9 }, matchups: [], landing: { ...landing, versus: [{ url: "x", confidence: 7, why: "" }] }, verdict: { publishable: false, minConfidence: 7, why: "Only 9 of 15." }, writtenAt: new Date().toISOString() } }).eq("id", run.id);
  assert.equal(await researchAd(agentId), null);
  const plain = await onDomain(new URL(landingPageUrl(agent, plans[0].key)).pathname);
  assert.equal(plain.status, 200);
  const plainText = visible(plain.text);
  assert.ok(!plainText.includes(landing.subhead) && plainText.includes(plans[0].descriptions[0]) && plainText.includes("Get your free quote"), "the page falls back to the ad group's own copy");
  ok("research that missed 9/10: no research ad, the page uses the ad group's own copy and still takes quote requests");

  console.log("\ngreenlight → live: all passed");
} finally {
  await db.from("voice_do_not_call").delete().eq("phone", PHONE);
  if (agentId) await db.from("agents").delete().eq("id", agentId); // cascades to the brand, Google account, research, leads, calls, bookings
}

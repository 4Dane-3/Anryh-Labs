# The anryh labs system for hair transplant clinics: what's built, and the prompts to rebuild it

This is the inventory of everything running in the anryh labs codebase, adapted for hair transplant clinics, with a build prompt for each part so someone can rebuild it with Claude Code. It's written to become paid community material.

The engine was built for life insurance agents and roofers. The mechanics carry over as they are (booking, speed-to-lead calls, the AI media buyer, creative, Google Ads, follow-ups). What changes for clinics is the conversion, the qualifying questions, the ad rules and how patient data is handled. Those changes are written into every prompt below.

**How to use the prompts:** start a fresh Next.js + Supabase project, open Claude Code in it, and paste the prompts in order. Each one names what "done" looks like. Build in this order, because later systems read from earlier ones. Prompts assume a US clinic. UK and EU differences are noted where they matter.

---

## The clinic model in one page

**The patient:** mostly men 25–60, plus a growing share of women, who have been thinking about a transplant for months. They compare clinics, prices and countries (Turkey especially), worry about looking "done", and fear being sold to. They arrive from a phone, often late at night.

**The conversion:** a booked consultation, either virtual (with photos sent first) or in clinic. That's what every system optimises for. A form fill or a click is only a signal.

**What happens after:** photos received → consultation held → quote given → deposit paid → surgery date booked → procedure → follow-ups → 12-month result → review and referral. Migz ranks ads on how far down this chain their leads get, not on lead count.

**Services a clinic usually sells** (each becomes an ad group, a landing page and a creative topic): FUE, DHI, FUT, hair transplant cost and financing, women's hair restoration, beard transplant, eyebrow transplant, repair of a previous transplant, and non-surgical options (PRP, medication plans) as a lower-commitment entry.

**What the clinic sets once in setup:**
- procedures offered, and whether they treat women
- minimum patient age (18 by law for cosmetic ads on Meta; many clinics set 21 or 25)
- consult types (virtual, in clinic, both), consult fee or free, and whether photos are required first
- service area and whether they take travel patients
- financing on or off, and the provider
- surgeon names, credentials (board certification, ISHRS membership), years and procedure counts **only as they give them**
- the proof they have: reviews, video testimonials with signed consent, awards

---

## 0. The stack

| Layer | What we use | Why |
|---|---|---|
| App | Next.js (App Router), React, Tailwind, TypeScript | One codebase for the marketing site, the clinic dashboard, booking pages and the API |
| Database, auth, cron | Supabase (Postgres, Auth, Storage, `pg_cron`) | Per-clinic data, magic-link login, scheduled jobs that call `/api/cron/*` with a shared secret, private storage for patient photos |
| Hosting | Vercel | Also serves each clinic's own ad domain (`consult.theirclinic.com`) via the Vercel API |
| AI brain | Anthropic Claude: Haiku (research, compliance checks, wording), Sonnet (runs the reviews, vision), Opus (advisor before any spend change, weekly strategy) | Tiered by task, with a monthly AI budget per clinic |
| Ads | Meta Marketing API + Conversions API, Google Ads API (from a manager account) | Migz runs both |
| Creative | Higgsfield (video and images), HeyGen (surgeon's photo talking, lip-synced), ElevenLabs (voice clone, narration, music, SFX), a Docker render worker (ffmpeg + HyperFrames) | Finished video ads without an editor |
| Voice | ElevenLabs Agents + a Twilio number | Calls every new enquiry within seconds |
| Messaging | Slack (Block Kit), Resend (email), Twilio SMS | Clinic updates, consult confirmations, follow-ups |
| Payments | Stripe Checkout | Clinics add ad funds; our fee is taken from each deposit |
| Research | Apify scrapers (Google Maps, Google Ads Transparency, Meta Ad Library, Google reviews) | Competitor ad research |

**Build prompt 0: the base**

```
Set up a Next.js (App Router, TypeScript, Tailwind) app with Supabase for a hair transplant clinic marketing platform.
- Supabase clients: a browser client for sign-in, a cookie-backed server client that only reads the session, and a service-role admin client used by server code only (created lazily so builds don't need the secret).
- Magic-link login. On first sign-in, link the user to an unclaimed `clinics` row whose email matches.
- A `clinics` table: slug, clinic name, timezone, address, service radius, accepts_travel_patients, phone, brand fields (logo, accent, fonts), surgeons (name, title, credentials as typed), procedures offered (fue, dhi, fut, women, beard, eyebrow, repair, prp), min_patient_age (default 21, never below 18), consult_types (virtual, in_clinic), consult_fee (0 = free), photos_required_before_consult, financing (on/off, provider name), and a settings JSON.
- An `admins` check for staff.
- A private Supabase Storage bucket `patient-photos`: no public URLs, signed URLs only, readable by that clinic's users and staff.
- Cron auth: routes under /api/cron/* accept only `Authorization: Bearer <CRON_SECRET>`, scheduled with pg_cron + pg_net.
- An integrations helper where each integration turns on only when its env keys exist.
- A rate limiter on every public form (IP bucket, max hits per window, stored in Postgres).
- An audit log table: who viewed or exported a patient's record and when.
Done when: I can log in as a seeded clinic, see an empty /dashboard, a test cron route rejects calls without the secret, and a photo uploaded to patient-photos can't be opened without a signed URL.
```

---

## 1. Consultation booking page (the conversion point)

**What it does:** Each clinic gets a public page with the surgeon's photo and credentials, a calendar of open consultation times (virtual and in clinic), a short pre-consult form, a photo upload step, a "call now" button during clinic hours, and a "rather talk first? we'll call you now" form.

**Key rules:**
- Slots come from weekly hours per consult type, in the clinic's timezone. Virtual and in-clinic consults can have different lengths and different consultants.
- The pre-consult form asks only what the consultant needs to prepare, and every answer is optional except name and phone: what they want help with (hairline, crown, overall thinning, beard, eyebrows, repair), how long they've noticed it, previous transplant yes or no, virtual or in clinic, and rough timing. **No medical history, medications or conditions on a public form.** The consultant asks that in the consult.
- Photo upload (front, top, crown, both sides, with example pictures of each angle). Photos go to private storage only. If the clinic requires photos first, the booking can still be made, and the patient gets a reminder link to upload them.
- The consent line next to the phone field names automated and AI-voice calls, texts and recording. **Have a lawyer approve it.**
- Picking a time is not a booking. Track both and never report one as the other.
- Cookie-free page analytics, and **no Meta pixel or Google tag on any page that collects health answers or photos**. Conversions go server-side with contact details only (see section 11).
- The clinic's colours and fonts theme the page. Their accent is darkened just enough for white text to pass 4.5:1 contrast.

**Build prompt 1**

```
Build a public consultation booking page at /[slug] for each hair transplant clinic.
- Header with the clinic's logo, the lead surgeon's photo, name and credentials exactly as the clinic typed them, and the clinic address.
- Consult type picker (virtual / in clinic, only the ones the clinic offers), showing the fee or "free consultation".
- Calendar of open slots for the next 21 days from per-type weekly hours in the clinic's timezone (luxon, DST-safe), each type with its own length and step, and a buffer.
- A short pre-consult form the clinic can edit, with these defaults, all optional: what they'd like help with (hairline, crown, overall thinning, beard, eyebrows, fixing a previous transplant, not sure), how long they've noticed it (under 1 year, 1–3 years, 3+ years), had a transplant before (yes/no), when they're hoping to have it done (as soon as possible, 3–6 months, just researching). No medical history, medication or condition questions. Store answers with a snapshot of each question's label.
- Photo step after booking: five angles (front, top, crown, left, right) with example images; upload to the private patient-photos bucket with browser-side compression and HEIC conversion. If skipped, email a private upload link.
- Phone field with a consent line stored on each booking (wording in a constants file marked LAWYER REVIEW; it must name automated technology, an artificial or AI-generated voice, texts and recording).
- Honeypot and IP rate limiting on submit; a minimum age confirmation checkbox using the clinic's min_patient_age.
- "Call the clinic" button only inside clinic hours, and a "Rather talk first? We'll call you right now" form that saves a call-back request.
- One server function createConsult() used by every booking path: re-checks the slot, saves the booking, emails the patient a confirmation (Resend, table layout, .ics attached, video link for virtual consults, under the clinic's name, replies to the clinic), emails the clinic, POSTs to the clinic's CRM webhook if set, and sends a server-side conversion with hashed contact details only.
- No Meta pixel or Google tag on this page. Cookie-free analytics: random visit id per tab session, events flushed on visibilitychange; save utm and fbclid/gclid from the URL with the visit and the booking.
Done when: I can book a virtual consult as a patient, upload five photos, the slot disappears, the confirmation email logs in dev, and the dashboard shows the funnel (visited, saw times, picked a time, booked, photos received).
```

---

## 2. Speed-to-lead voice agent

**What it does:** Every new enquiry (a "call me" request, a Meta lead form, a landing page form) gets a call from an AI assistant within seconds. It confirms what they're interested in, books a consultation on the call and asks for photos. Hair transplant enquiries go cold fast because patients are comparing clinics, so speed is the whole point.

**Key rules (unchanged from the engine):**
- The call is placed in the same request that saved the lead. Everything the agent needs goes in as dynamic variables.
- **The server decides, not the model.** Open times come from an `open_times` tool, booking goes through `book_consult` (which re-checks), and fit against the clinic's rules is checked in code by `check_fit`. A missing or "not sure" answer never blocks a booking.
- Calls only between 8am and 8pm in the patient's timezone, one retry. `do_not_call` is honoured everywhere at once.
- The agent says it's an AI and that the call may be recorded.
- In dev nothing is dialed, and a test-number variable sends every call to your own phone.

**What changes for clinics:**
- **No medical advice, ever.** The agent never estimates grafts, says whether someone is a candidate, comments on their hair, discusses medication, side effects or recovery, or quotes a price. "That's exactly what the consultant will go through with you."
- **Price questions are the most common.** The agent can say whether the consultation is free and whether the clinic offers financing (from the clinic's settings), and that the exact quote comes after the consultant sees photos.
- **Comparing with Turkey or other clinics:** never disparage anyone. "Lots of people look at a few options. The consultation is a good way to see if we're the right fit."
- **Anything sounding urgent or medical** (pain, infection, a problem after a procedure elsewhere): the agent says to contact their doctor or emergency services if it's urgent, and flags the call for the clinic. It never assesses symptoms.
- **Fit rules the server checks:** under the clinic's minimum age, a procedure the clinic doesn't offer, women when the clinic doesn't treat women, outside the service area when they don't take travel patients.
- **Transcripts contain health information.** Store them as patient data (see section 11).

**Build prompt 2**

```
Add a speed-to-lead voice agent for hair transplant enquiries using ElevenLabs Agents with a Twilio number.
- When an enquiry is saved (call-me form, landing page form or Meta lead webhook), place the call in the same request: POST /v1/convai/twilio/outbound-call with dynamic variables lead_id, first_name, greeting, clinic_name, surgeon_name, city, interest (what they selected), consult_types, consult_fee_text ("free" or the amount), financing_text (empty when off), clinic_hours, lead_timezone, lead_source.
- Only call 8am–8pm in the lead's timezone; queue others for the next window (cron every few minutes). One retry on no answer. Never call anyone on the do-not-call list or whose consent doesn't cover AI calls.
- Server tools at /api/voice/tools/[tool], each POST with header x-voice-secret, lead_id bound to the dynamic variable:
  - open_times(type, day?) -> next open consult slots of that type with spoken labels in the lead's timezone
  - check_fit(answers) -> { fits, still_to_ask } computed in code from the clinic's rules: age >= min_patient_age, procedure offered, treats women, in service area or accepts travel patients. Missing or "not sure" never blocks.
  - book_consult(start, type, name, email, interest, previous_transplant, timing) -> calls createConsult(), re-checks fit and slot, emails the photo upload link
  - flag_for_clinic(reason) -> alerts the clinic by email and Slack (medical concern, wants a person, complaint)
  - do_not_call() -> adds to the list immediately
- POST /api/voice/post-call: verify the HMAC, save transcript, duration and collected fields (outcome: booked, not_a_fit, callback, no_answer, do_not_call, voicemail; interest; consult_type; previous_transplant; timing; callback_time; email) on a voice_calls row in the patient-data tables. The server overrides outcome to not_a_fit when check_fit ruled the lead out.
- Dev safety: outside production nothing dials; VOICE_LIVE_CALLS=1 with VOICE_TEST_NUMBER sends every call to that number only.
- Write the agent's first message and system prompt into docs/voice-agent.md:
  First message: "{{greeting}}, this is the AI assistant for {{clinic_name}}, calling about the hair transplant enquiry you just sent. Just so you know, this call may be recorded. Do you have a quick minute?"
  System prompt rules: say plainly it's an AI if asked; one or two short sentences per turn, one question at a time, warm and unhurried, never pushy. Flow: confirm it's a good moment; ask what they're hoping to get help with (skip if known); ask if they've had a transplant before; ask virtual or in clinic (only offer what consult_types allows); call check_fit; offer two times from open_times by label; book_consult with the chosen start exactly as returned; ask for an email for the confirmation and photo link (don't push); confirm the day, time and type, say the consultant will review their photos and go through options and an exact quote, then end.
  Never: estimate grafts, say whether they're a candidate, comment on their hair, discuss medication, side effects, recovery or results, quote a procedure price, promise outcomes, or criticise other clinics or countries. Price question -> say what consult_fee_text and financing_text say, and that the exact quote follows the consultation. Medical or urgent concern -> say to contact their doctor or emergency services if urgent, call flag_for_clinic, and offer a callback from the team. "Stop calling" or wrong number -> do_not_call immediately, apologise, end. Voicemail -> end without leaving details.
Done when: a test lead in dev logs a simulated call, and a script can call each tool, book a consult, and post a signed sample post-call payload.
```

---

## 3. Migz: the AI media buyer (Meta)

**What it does:** Migz launches and runs the clinic's Facebook and Instagram campaign. It builds the campaign, makes or uses creatives, pauses losers, adds new creative in waves, moves budget, and logs every change with a reason the clinic can read. The clinic picks "approve each change" or "autopilot within limits".

**How it's built (the parts worth teaching):**

| Part | What it does |
|---|---|
| Sync | Pulls per-ad daily insights, per-placement splits, ad set budget, status and learning phase from Meta into our own tables |
| Snapshot | Builds everything one review needs (campaign tree, 14-day and 3-day results per ad, booking-page funnel, patient-journey outcomes per ad, money, recent actions) as JSON for the model, plus the state the guardrails check |
| Quiet-run gate | Plain code decides if anything changed enough to wake a model |
| Operator | Sonnet runs the review with tools. Opus is the advisor, and the code **rejects** any spend-affecting action unless the advisor was consulted earlier in that review |
| Guardrails | Hard limits in code on every action: budget cap, learning-phase protection, the creative cycle, the clinic ad rules. A rejection returns a reason the model can read and adapt to |
| Team (Haiku) | Auditor, clerk (second compliance pass on copy), librarian (this clinic's own history), scout and finder (public-web research into a swipe file, never scraping ad platforms) |
| Memory | Experiment ledger ("never end early" enforced), learnings library that ages out, nightly notebook |
| Router | Every model call goes through one place, with a monthly AI budget per clinic and cost logging |
| Brain page | A live view of what Migz is doing, from real step events only |

**The playbook, in clinic terms:**
- **The goal is booked consultations, ranked by what happens next.** Once an ad has 5 outcomes from the clinic, rank it on cost per consult held, then per deposit. A cheap lead who never sends photos or never shows isn't cheap.
- **Long consideration.** Patients research for months, so don't judge an ad on same-week surgeries. Judge on consults booked and held, and let the clinic's deposit data refine it over time.
- **Targeting:** cosmetic procedures aren't a Meta special ad category in the US, so age and gender targeting are allowed. Start broad (men 25–60 in the radius, or nationwide for travel-friendly clinics) and let creative do the rest. Run women's restoration as its own topic with its own creative. Never target under 18. Health interests are limited, so don't rely on them.
- **One campaign, one ad set** at small budgets, with topics (FUE, women's restoration, beard, repair, cost and financing) compared ad by ad inside it.
- **Creative cycle:** launch the full mix, change nothing for 7 days, then every 14 days pause clear losers and add one wave of 2–3 new creatives.
- **A clear loser** has spent 2.5× the target cost per consult with no booking or lead. Never judge on under ~1,000 impressions or $15 of spend.
- **Diagnose before acting:** low hook rate means a new hook; good hook but low hold means a new body; good hold but low clicks means new copy; good clicks but no bookings means read the page funnel and fix the page.
- **Lead forms vs the booking page:** Meta instant forms bring more, lower-intent leads. While the account books under 10 consults a week, run a lead form ad set beside the booking page and optimise for Lead. The voice agent calls form leads in seconds, which is what makes form leads worth having.

**Clinic ad rules Migz must follow** (check Meta's current health and wellness, personal attributes and cosmetic procedures policies before launch, since they change):
- No before-and-after images or video, and nothing showing an unlikely or idealised result.
- No calling out personal attributes or implying the viewer has hair loss: never "Are you going bald?", "Tired of your receding hairline?" or "You deserve your hair back." Speak to the decision instead: "Thinking about a hair transplant in Austin?", "What actually happens at a hair transplant consultation."
- No guaranteed results, "permanent", "100% natural", "painless" or "no scarring" claims, no "best surgeon" or "cheapest" claims, and no graft-count promises.
- No body shaming, nothing that plays on insecurity, and no imagery of distress about appearance.
- No time-limited pressure offers for surgery (UK rules discourage them outright; elsewhere they're a rejection risk and a bad look).
- Prices only exactly as the clinic gives them. Financing only if the clinic offers it, with no credit claims.
- Testimonials only from real patients with signed consent, with typical-results context (FTC endorsement guides).
- Surgeon credentials only as typed by the clinic.

**Build prompt 3a: sync, snapshot, guardrails**

```
Build the data side of an AI media buyer for a hair transplant clinic's Meta ads.
- A minimal Graph API client with a pinned version, retries only on throttling codes and on safe operations (never blindly retry a create after a 5xx).
- sync(): pull per-ad daily insights (spend, impressions, clicks, 3-second views, ThruPlays, link clicks), the same by placement, and ad set budget/status/learning stage into our tables; roll up daily metrics.
- snapshot(clinicId): the campaign tree with 14-day and 3-day results per ad, hook rate, hold rate, CTR, consults booked per ad (from our own bookings, matched by utm), the booking page funnel for ad visits (visited, saw times, picked a time, booked, photos received), and per-ad patient-journey outcomes (consult held, no show, quoted, deposit, not a candidate). Return { modelJson, guardState }. No patient names, answers or photos in modelJson: counts only.
- guardrails.ts, pure functions returning null or a reason: never exceed the daily budget cap; no budget, targeting or placement change on an ad set that's learning or changed in the last 3 days; budget changes at most 25%; pause only when spend >= 2.5x target cost per consult with no result; at least one live ad per ad set; days 1–7 learn only; at most one creative wave per 14 days; minimum age targeting 18 (or the clinic's minimum, whichever is higher).
- clinic-ad-rules.ts: regex checks that reject copy with before/after wording, personal-attribute callouts (are you balding/losing your hair/thinning, your hairline, your bald spot), guarantees (guaranteed, permanent results, 100%, painless, no scar, scarless), superlatives (best, cheapest, #1, top-rated unless the clinic supplied the source), graft promises (\d+ grafts guaranteed), countdown pressure (today only, ends tonight, last chance), and any price or credential not in the clinic's settings.
- A quiet-run gate that skips the model when nothing material changed.
- Unit tests for every guardrail, every ad rule (with passing and failing examples) and the gate.
Done when: the tests pass and a dry run prints a snapshot JSON and the gate's decision for a seeded clinic.
```

**Build prompt 3b: the review loop**

```
Build the review loop on top of the snapshot and guardrails.
- A model router: every Claude call goes through it; the task picks the tier; a monthly AI budget per clinic is paced into a daily allowance (what's left ÷ days left) and can push work to a cheaper tier; log tokens, cost and latency.
- The operator: Sonnet with tools (pause_ad, resume_ad, set_budget, launch_creative, write_copy_variants, plan_experiment, record_learning, hold). An advisor tool calls Opus with the whole review; in code, reject any spend-affecting call unless the advisor was consulted earlier in the same review.
- Every tool call runs through the guardrails and clinic ad rules; a rejection goes back as the tool result so the model adapts. "Approve" mode turns actions into proposals the clinic accepts in the dashboard; "auto" mode applies them.
- A byte-stable system prompt (no dates, ids or clinic data) that says: you are Migz, the media buyer for a hair transplant clinic; the goal is booked consultations, ranked by consults held and deposits once an ad has 5 outcomes; patients research for months, so never judge on same-week surgeries; topics are FUE, DHI, FUT, women's restoration, beard, eyebrow, repair, cost and financing, non-surgical; one campaign one ad set, compare topics ad by ad; 7-day learn, 14-day waves; the diagnosis ladder (hook rate -> hold rate -> CTR -> page funnel); never judge under 1,000 impressions or $15; under 10 consults a week, optimise for Lead and run a lead-form ad set beside the booking page; the clinic ad rules in full (no before/after, no personal attributes, no guarantees or superlatives, no pressure offers, prices and credentials only as given, testimonials only with consent); proven angles: what a consultation involves, the surgeon explaining FUE vs DHI, a clinic tour, a real patient's story told by the patient with consent, transparent pricing or financing when the clinic allows it, the recovery timeline explained (no results promised), local and travel convenience. Write each action as a short past-tense title plus one sentence with the numbers.
- Snapshot and today's date go in the user message. Use prompt caching.
- Every action is saved with its title and reason and appears in the clinic's activity feed.
- Cron: check hourly, run a review at most every 6 hours per clinic.
Done when: against a seeded clinic with fake Meta numbers, a review runs end to end, a guardrail rejects one action and the model adapts, and an attempted "Are you losing your hair?" copy variant is rejected by the ad rules.
```

**Build prompt 3c: the team and memory**

```
Add Migz's support team and memory, all on Haiku unless noted.
- Auditor: code checks (server-side conversions arriving, disapprovals, pacing, landing page loads, no pixel on pages with health answers), then Haiku ranks them in plain English. One open finding per check + subject; it resolves when the check stops firing.
- Clerk: a second, semantic compliance pass on new copy after the regex rules, with the clinic ad rules as its instructions. It also writes the activity-feed wording.
- Librarian: search this clinic's own past actions, experiments and learnings and boil matches down to a few dated bullets.
- Scout: web search for what's working in hair transplant and hair restoration advertising, from public sources only (never scrape ad platforms), filed in a shared swipe file as inspiration, never to copy wording.
- Experiment ledger with minimum samples enforced; learnings library (one sentence with numbers and dates, aged out after 60 days).
- Nightly summary at 9pm clinic time, every third evening, to Slack: spend, consults booked and held, what changed and why, one booking-page fix (photo step drop-off is the usual one).
Done when: a review's context includes open findings, librarian bullets and live experiments, and a nightly summary renders as Slack Block Kit in a test.
```

---

## 4. Creative production

**What it does:** Makes the ads Migz launches: surgeon-on-camera videos, clinic footage edits, image ads on the clinic's own photos, and generated lifestyle visuals.

**What works for clinics, and what never runs:**
- **Best performers are real people from the clinic:** the surgeon explaining FUE vs DHI in 20 seconds, "what happens at your consultation", a clinic walkthrough, the patient coordinator answering the price question, and a real patient telling their story with signed consent.
- **Generated video** is for lifestyle scenes only (a man in his 30s getting ready for a wedding, a friend's photo, a confident moment), with no hair close-ups and no implied before or after. Nobody on screen talks; a narrator voices it.
- **Never:** before-and-after, scalps or grafts up close, surgery footage, blood, the donor area, a person looking distressed at a mirror, a real patient without signed consent, or a manufacturer's logo.
- **The surgeon's "clinic look":** instead of the roofer's jobsite look, the surgeon's photo becomes a HeyGen avatar in a calm, modern consult room, waist up, in scrubs or a clinic jacket, soft daylight. Every presenter video is made from that look.
- **The edit spec** from the engine applies as it is (tight cut, grade, zooms on the eyes, two-weight captions on the torso, safe zones, -14 LUFS, loop to frame 0). Swap the town-pin hook for a "[CITY] · HAIR TRANSPLANT CONSULTATIONS" callout, the license card for the surgeon's credentials, and the end card to "Tap Learn More to book your free consultation" (or the clinic's consult fee).
- Logos are added in code, Advantage+ creative enhancements are off on every creative, and every video waits for the clinic to approve it.

**Build prompt 4**

```
Build creative production for a hair transplant clinic's Meta ads.
- creative_jobs with stages generating -> stored -> awaiting_approval -> meta_processing -> launched | failed; a 10-minute cron and the provider webhook advance them; copy every finished file into Supabase Storage.
- Briefs stored on the creative, each tagged with a topic (fue, dhi, fut, women, beard, eyebrow, repair, cost, non_surgical): video = hook shot + body shots (a new hook can reuse a winning body); image = photo + 1–3 short lines + button label ("Book a free consultation" or the clinic's wording); carousel = 2 square cards.
- Brief rules enforced before generation: no before/after, no hair or scalp close-ups, no surgery, no distress at a mirror, no real people unless the clinic uploaded them with a consent flag, 1–3 people doing something specific in natural light, nobody on screen talking. Run the brief's words through the clinic ad rules.
- Image ads on the clinic's own photos (consult room, team, surgeon, reception) with no generation: crop to 4:5 or 9:16 keeping the busiest region, a soft shade for the lines, the last line in the accent colour, a button shape.
- Surgeon on camera: the surgeon uploads a photo and a 1–2 minute voice sample; make a HeyGen photo avatar and a "clinic look" (waist up in a modern consult room, scrubs or clinic jacket, soft daylight, no logos), clone the voice in ElevenLabs, write a 20–30 second script from the clinic's facts (what a consultation covers, FUE vs DHI in plain words, how to book), and render through the edit worker. Hook callout "[CITY] · HAIR TRANSPLANT CONSULTATIONS"; credentials card only from what the clinic typed; end card "Tap Learn More to book your free consultation".
- Add the clinic's logo in code (corner mark, video end card). Opt every creative out of Meta's Advantage+ creative enhancements.
- Video approval: a video waits at awaiting_approval until the clinic presses Approve on /review/<token> (POST only; GET just shows it). Ask once per batch by email and Slack, remind once after two days.
Done when: a test job goes from generating to launched with stub providers, a brief containing "before and after" is refused, and an image ad renders from a sample clinic photo with the logo mark.
```

---

## 5. Google Search ads

**What it does:** Builds and runs a Search campaign in the clinic's own Google Ads account, managed from our manager account. The clinic pays Google directly. Search is where patients who are ready to compare clinics show up, so it often books the highest-intent consults.

**Clinic specifics:**
- **Ad groups:** FUE hair transplant, DHI, hair transplant cost, hair transplant financing (only if offered), women's hair restoration, beard transplant, eyebrow transplant, hair transplant repair, and non-surgical hair loss treatment. Each with phrase and exact keywords, "near me" and city variants, and the clinic's own name.
- **Starting negatives:** jobs, salary, course, training, school, free, NHS (UK), insurance-covered, cheap, DIY, at home, shampoo, oil, minoxidil and finasteride purchase terms, wig, toupee, hair system, hair extensions, hair salon, barber, dog, cat, "Turkey" and other countries (unless the clinic is there), "gone wrong", lawsuit, and procedures the clinic doesn't offer.
- **Google's healthcare and personalised-ads rules:** remarketing and Customer Match based on health (including hair loss) are restricted, so don't build remarketing lists from enquiry data. Ad copy follows the same clinic rules as Meta.
- **Conversions:** booked consult (uploaded, used for bidding), call from ad 60s+, and deposit paid (uploaded with value, reporting only, then bidding once there's volume). Hashed email and phone only, never health answers.
- **Location:** "people located in" the radius for local clinics. Travel-friendly clinics run a second, nationwide campaign with its own budget cap.
- **Daily review rules** carry over: search terms daily, pause keywords at 2× target with 15+ clicks and no conversion, 2–3 ads per group, budget raised only when converting at target and losing 10%+ impression share to budget, target CPA only after 15+ conversions in 30 days, first 7 days negatives only.

**Build prompt 5**

```
Add Google Search ads for hair transplant clinics, managed from a Google Ads manager account (REST API, version in an env var).
- Account linking: send a manager link request if the clinic has an account (check hourly until accepted); otherwise create one under the manager and invite their email as admin.
- build(): auto-tagging on; conversion actions "Booked consultation" (uploaded, for bidding), "Call from ad 60s+", and "Deposit paid" (uploaded with value, reporting only); a Search campaign (Google Search only, people located in the radius, English, Maximize conversions, daily budget = monthly cap / 30.4); optionally a second nationwide campaign when accepts_travel_patients is on, with its own cap.
- Ad groups only for procedures the clinic offers: fue, dhi, cost, financing (only when financing is on), women, beard, eyebrow, repair, non_surgical. Each with phrase + exact keywords plus "near me" and city variants; a responsive search ad (15 headlines, 4 descriptions) from the clinic's facts only (consult fee or free, virtual consults, surgeon credentials as typed, financing if on, years and reviews only if supplied).
- ~70 starting negatives: jobs, salary, course, training, free, cheap, insurance, DIY, at home, shampoo, oil, minoxidil, finasteride, buy, wig, toupee, hair system, extensions, salon, barber, gone wrong, lawsuit, other countries unless the clinic is there, and procedures not offered.
- Never create remarketing or Customer Match lists from enquiry or patient data.
- sync(): campaigns with impression share (lost to budget and rank), keywords with quality score, 14 days of search terms, ads with strength and approval.
- Spend control in code: never above each campaign's monthly cap; pause at the cap; resume next month only if we paused it.
- Upload "Booked consultation" for bookings with a gclid/gbraid/wbraid, and "Deposit paid" with value when the clinic marks a deposit; hashed email and phone only.
- A daily Claude review with tools and guardrails: block irrelevant terms, add converting terms as exact, pause keywords at 2x target CPA with 15+ clicks and no conversion, keep 2–3 ads per group, budget +25% max at least 3 days apart only when converting at target and losing 10%+ IS to budget, tCPA only after 15 conversions in 30 days, first 7 days negatives only. Ad text checked for Google's lengths and the clinic ad rules.
- GOOGLE_ADS_VALIDATE_ONLY=1 makes every mutation validate-only.
Done when: in validate-only mode the build runs against a test account without errors, a clinic without financing gets no financing ad group, and the guardrail tests pass.
```

---

## 6. Landing pages per ad group

**What it does:** Each ad group gets its own page on the clinic's ad domain (`consult.theirclinic.com/fue-hair-transplant`). The headline is the ad's first headline, so the click lands on the promise it clicked. A consultation form sits next to the hero.

**Clinic page sections, in order:** hero with the consult form; the surgeon (photo, name, credentials as typed); how a consultation works (send photos, talk to the consultant, get a plan and an exact quote, no obligation); the procedure explained in plain words (for that ad group only); what recovery usually looks like (described generally, no promised results or timelines); Google review badge and written reviews; video testimonials (consented only); pricing or financing (only if the clinic wants it shown); FAQs (cost, pain, downtime, who's a candidate, all answered with "your consultant will go through this" where it's medical); clinic location and travel info.

**Rules:** no before-and-after galleries on ad landing pages (Meta reviews landing pages too), proof only from what the clinic gave, empty sections hidden from visitors and shown as placeholders to staff in preview, pages `noindex`, and no tracking tags on the page that collects answers or photos.

**Build prompt 6**

```
Build one landing page per ad group at /[slug]/p/[group] for hair transplant clinics, also served on the clinic's verified ad domain.
- Groups: fue-hair-transplant, dhi-hair-transplant, hair-transplant-cost, hair-transplant-financing, womens-hair-restoration, beard-transplant, eyebrow-transplant, hair-transplant-repair, non-surgical-hair-loss. Only procedures the clinic offers get a page.
- Headline = the ad group's first headline, subhead = its first description.
- Hero in the clinic's accent with a short consult form beside it (name, phone, email, virtual or in clinic, consent line). Submitting saves an enquiry and triggers the voice agent if it's on; otherwise no fast-call promise.
- Sections driven by an optional proof JSON on the clinic: surgeon block, how a consultation works, procedure explainer (per group, plain words, no promised results), recovery overview (general, no timelines promised), Google review badge, written reviews, video testimonials (only items flagged consented), pricing or financing (only if the clinic turned it on), FAQs, location and travel info. Hide any section with no data; with ?preview=1 and a staff session show a placeholder instead.
- No before/after images anywhere on these pages. Run every line of page copy through the clinic ad rules.
- noindex on every landing page; no third-party tracking tags.
- Ad domain: the clinic enters consult.theirdomain.com; validate it's a subdomain; add it to the Vercel project via API; a "Check again" button verifies the CNAME and HTTPS; only then do ad links use it.
Done when: a seeded clinic offering FUE and DHI only gets two pages, partial proof shows only the filled sections, and preview mode shows placeholders for the rest.
```

---

## 7. Competitor research and ad writing

**What it does:** Studies the clinic's top local competitors and a benchmark market, pulls every Google and Meta ad they run, ranks the winners, reads the clinic's own site and reviews for what it can honestly claim, writes 150 headlines, and keeps only the ones that beat competitor winners in blind tests.

**Clinic specifics:**
- Search "hair transplant clinic" and "hair restoration" in Google Maps. Leave out barbers, salons, wig shops and general dermatology unless they advertise transplants.
- For the benchmark market, pick a competitive one: a big US metro, London, or Istanbul (the most aggressive hair transplant advertisers in the world, worth studying for offers and hooks, never for claims).
- Real offers in this niche: a free consultation is **not** an offer (everyone has it). Offers are things like a fixed all-inclusive price, financing at a stated rate, a free PRP session with surgery, a free virtual photo assessment within 24 hours, or a guarantee the clinic actually stands behind.
- "Can claim" usually includes: surgeon credentials, years, number of procedures, review count and rating, techniques offered, virtual consultations, financing. "Never say" always includes guarantees of results, "permanent", "painless", "scarless", and anything another clinic says that this one can't prove.
- Angles to cover across the final 15 headlines: consultation, surgeon trust, price transparency, technique (FUE/DHI), convenience (virtual, local), risk reversal (no obligation).

**Build prompt 7**

```
Build a competitor research pipeline for hair transplant clinics that runs in steps across cron ticks (each Apify run is async with a hard spend cap).
1. Google Maps: top 50 results for "hair transplant clinic" and "hair restoration" in the clinic's area and in a benchmark market (default: a large US metro; options London and Istanbul); exclude the clinic itself, barbers, salons, wig shops, and dermatology practices with no transplant service on their site.
2. Read each competitor's homepage for their Facebook Page link (never fetch Facebook directly).
3. Ads: Google Ads Transparency Center per domain and Meta Ad Library per Page, via Apify actors.
4. Read Google text ads (they arrive as images) with a small vision model; read each ad's landing page.
5. Rank per market and platform: local by days running, benchmark by impressions/reach per day; drop ads under 14 days, hiring posts and duplicates. Top Rated = best 15% (min 3). Best Offers = real offers only (fixed all-inclusive price, financing at a stated rate, something free with surgery, a fast photo assessment, a guarantee); a free consultation is not an offer.
6. The clinic's context from its site (up to 10 pages), 40 newest Google reviews and testimonials: Can claim (with source), Hold, Never say (always includes guaranteed results, permanent, painless, scarless, best/cheapest), The gap.
7. Write 150 headlines and 40 descriptions. Filter: (a) code rules: Google lengths, the clinic ad rules, every number and claim word must appear in the clinic's proof, no competitor names; (b) blind harsh-buyer test (a patient comparing three clinics) against 3 competitor winners, must win 4 of 5, rewrite losers up to 3 rounds; (c) variety: drop near-copies, no angle over a third, final 15 headlines cover at least 4 of 6 angles (consultation, surgeon trust, price transparency, technique, convenience, no obligation).
8. Final blind A/B against each competitor winner; publishable only at 9/10 confidence. Publish adds the ad to Google Ads PAUSED.
Admin page: who advertises, the ads (All / Top Rated / Best Offers), the clinic's claims, and ours vs theirs with every line marked passed or failed and why.
Done when: a run on a seeded clinic completes with stubbed Apify responses and the admin page renders each section.
```

---

## 8. After the consultation: the patient journey

**What it does:** Tracks each patient from enquiry to result, follows up automatically where it's safe, and feeds the outcomes back to Migz and Google so ads are judged on deposits, not leads.

**The stages the clinic taps:** photos received → consult held / no show → quoted → deposit paid → surgery booked → procedure done → not a candidate / went elsewhere / not now.

**Follow-ups that work for clinics:**
- **Photos reminder:** if a booked patient hasn't sent photos, a plain email and text the day before the consult with the upload link.
- **No-show rebook:** the same day, a short note with the booking link.
- **Quoted but undecided:** patients take weeks. A sequence the clinic writes (what's included, financing if offered, a surgeon video answering common questions, "any questions?") spaced over 4–8 weeks, then monthly until they opt out. No pressure deadlines.
- **Not now:** a check-in every 2–3 months.

**Post-procedure check-ins (changed from the roofer version):**
- Clinical aftercare stays with the clinic's staff. The AI assistant never asks about symptoms or healing.
- What the AI can do: a non-medical "how was your experience with us?" call or text about a week after the procedure, and a reminder to book the clinic's own follow-up appointments.
- If the patient mentions any medical concern, the assistant tells them to contact the clinic directly (or emergency services if urgent), flags it for the clinic straight away, and stops there. No review or referral mention on that call.
- **Reviews and referrals at the 12-month mark**, when the result has grown in, not the week after surgery. Never offer anything in exchange for a review. Check local rules before offering referral rewards in a medical setting (they're restricted in some places).

**Build prompt 8**

```
Build the patient journey for hair transplant clinics.
- Stages on each patient (one tap in the dashboard): photos_received, consult_held, no_show, quoted, deposit_paid (with amount), surgery_booked (with date), procedure_done, not_a_candidate, went_elsewhere, not_now. Save with timestamps; send deposit_paid to Google as a valued conversion and consult_held/deposit_paid to Meta as CRM conversions (hashed contact details only); expose per-ad stage counts to the review snapshot.
- Automated follow-ups, each written by the clinic (subject, body, delay; placeholders {first_name}, {clinic_name}, {surgeon_name}, {booking_link}, {photo_link}), always ending with the clinic's name and an unsubscribe line with its address. Plain paragraphs, no images:
  - photos reminder: day before the consult if no photos
  - no-show rebook: same day
  - quoted sequence: spaced over 4–8 weeks, then monthly until opt-out or a stage change
  - not-now check-in: every 2–3 months
  Text versions via Twilio only where the consent covers texts. A cron sends what's due, claiming each row first so overlapping runs can't double-send. Any stage change stops the sequence it no longer fits.
- Experience check-in about 7 days after procedure_done, by AI call (only if consent covers AI calls) or email: "How was your experience with us?" Tools: record_feedback(text, rating?) and flag_for_clinic(reason). The system prompt forbids asking about symptoms, healing or results; any medical mention -> tell them to contact the clinic directly (emergency services if urgent), call flag_for_clinic, end without mentioning reviews or referrals. Also remind them of their next clinic follow-up appointment if one is set.
- At 12 months after procedure_done: email asking how they feel about their result, with the clinic's Google review link (no incentive) and, if the clinic turned referrals on, a referral link to /r/[token]. Referred people are saved separately from enquiries, never called or texted automatically, and listed for the clinic to contact personally.
Done when: a test patient moved through each stage triggers the right follow-up, the 7-day check-in flags a call where the patient mentions swelling without mentioning reviews, and a referral submission emails the clinic without creating an enquiry.
```

---

## 9. The clinic dashboard and the business layer

**Dashboard tabs:** overview (spend, consults booked and held, deposits, cost per consult and per deposit, the activity feed of every automated change with its reason), Migz's brain (live), calendar, patients (cards with stage buttons, answers, photos behind a click that's logged), creatives and approvals, ad funds, landing pages, questions, follow-up emails, Google Ads, settings, and a "Start here" setup flow with sensible defaults.

**How money works** (unchanged from the engine): a one-time setup fee, then the clinic adds ad funds through Stripe Checkout. We keep 20% of each deposit (12% after their first $20,000), and the rest is their ad balance. Auto top-up, "keep going" renewals from the balance, a 30-day booked-consult guarantee (fee credited back if they kept it funded and running and got fewer than the target consults), and 1% ad credit for clinics that refer other clinics.

**Staff side (/admin):** every clinic at a glance, page analytics, error reports, health alerts, a sales CRM for signing clinics (meeting invites, reminders, no-show rebooks, monthly follow-ups), a demo-call tester for the voice agent, and read-only view-as-clinic. Patient photos aren't viewable by staff without a logged reason.

**Build prompt 9**

```
Build the clinic dashboard and billing.
- Tabs: Overview (spend, consults booked, consults held, deposits, cost per consult, cost per deposit, activity feed of every automated change with its reason), Calendar, Patients (cards with stage buttons, answers, photos opened by signed URL with each view written to the audit log), Creatives (uploads with a consent flag for any patient footage, generated, approval state), Funds, Landing pages, Questions, Follow-ups, Google Ads, Settings (procedures, min age, consult types and fee, photos required, financing, surgeons and credentials, hours, service area, travel patients). A "Start here" checklist that pre-fills defaults and ticks steps off.
- Approve mode: pending proposals listed with Approve / Reject; on approve, re-check guardrails against the latest numbers before applying.
- Stripe Checkout "Add funds": a paid session writes two wallet rows (deposit and our fee: 20%, 12% after a clinic's first $20,000 total); fee worked out when Checkout opens and stored on the session; refunds and chargebacks reverse proportionally; webhook verified.
- Auto top-up with a saved card, amount and threshold; one charge per cooldown; stop after a failure until a new card is saved.
- Staff /admin: clinics list, read-only view-as-clinic (the proxy blocks every change), browser error reports, health alerts de-duplicated per window. Staff opening patient photos must enter a reason, which is logged.
Done when: a test-mode $500 deposit shows $400 ad balance and a $100 fee row, staff can view a clinic's dashboard without changing anything, and opening a patient photo writes an audit row.
```

---

## 10. Scheduled jobs (what runs on its own)

| Job | Cadence | What it does |
|---|---|---|
| `cron/migz` | hourly | Sync Meta, run due reviews (max every 6h per clinic), Google Ads review |
| `cron/creatives` | every 10 min | Advance creative jobs, ask for video approvals |
| `cron/research` | every 10 min | One step of the research shift and competitor runs |
| `cron/nightly` | hourly, fires at 9pm local | Nightly Slack summary every third evening |
| `cron/voice-calls` | every few min | Dial queued enquiries and experience check-ins inside 8am–8pm |
| `cron/followups` | every 15 min | Photo reminders, no-show rebooks, quoted and not-now sequences, 12-month review emails |
| `cron/digest` | morning | The day's consultations for the clinic, with which patients sent photos |
| `cron/health` | regular | Staff alerts for broken things |

---

## 11. Patient data and compliance (read before building)

Clinics handle health information, which raises the bar above roofing or insurance. **None of this is legal advice. Have the clinic's counsel sign off before launch.**

- **HIPAA (US):** a clinic is a HIPAA covered entity if it bills health plans electronically. Many cash-only cosmetic clinics aren't, but some are, and state privacy laws (Washington's My Health My Data Act, California's CMIA and others) and the FTC Health Breach Notification Rule can apply either way. Build as if HIPAA applies: sign Business Associate Agreements with vendors that touch patient data where they offer one (Supabase, Twilio, ElevenLabs, Resend and others have BAA options on certain plans; check each), encrypt at rest, keep an audit log, and limit who can see what.
- **Tracking pixels:** HHS and the FTC have taken action against health providers whose pixels sent health details to ad platforms. Keep the Meta pixel and Google tags off any page that collects health answers or photos. Send conversions server-side with hashed contact details only, and never send answers, procedure interest or photos to an ad platform. The engine already does this for insurance prep answers; keep it that way.
- **Voice calls and texts:** TCPA consent naming AI voices, recording notice at the start of each call (some states need all-party consent), do-not-call honoured instantly, calling hours in the patient's timezone. Transcripts are patient data.
- **Ads:** Meta's health and wellness and personal attributes policies, Google's healthcare and personalised advertising policies (no remarketing on health), FTC endorsement guides for testimonials, state medical board advertising rules, and in the UK the ASA/CAP rules on cosmetic interventions (no ads aimed at under-18s, no time-limited deals for surgery) plus CQC and GMC guidance.
- **Reviews and referrals:** no incentives for reviews. Check local rules before offering referral rewards in a medical practice.
- **Patient photos and testimonials:** signed consent stored with each one, and a way to withdraw it that removes the asset from every live ad.

**Build prompt 11**

```
Harden the platform for patient data.
- Classify tables: patient data (enquiries, bookings, answers, photos, voice transcripts, stages, follow-up history) vs business data. Patient data tables get row-level security scoped to the clinic, and every read from staff tools writes to the audit log.
- Make sure no page that collects answers or photos loads any third-party script; add a test that fails if one is added.
- Conversions API and Google conversion uploads send only hashed email, hashed phone, event name, time, click ids and value; add a test that fails if any answer field is in the payload.
- Consent: store the exact consent text version with each enquiry; a consent withdrawal endpoint for patient photos and testimonials that marks the asset withdrawn and pauses every live ad using it (and tells the clinic).
- Retention settings per clinic: delete transcripts and photos of patients who never booked after N months (default 12), with a nightly job.
- A data export and delete request flow for a patient, run by clinic staff.
- A /docs/compliance.md listing every vendor that touches patient data and whether a BAA is signed (blank to fill).
Done when: the tests for third-party scripts and conversion payloads pass, withdrawing consent on a test video pauses its ad, and the retention job deletes a seeded old record.
```

---

## What to package and how

**Free (IG and lead magnet):**
- Why speed-to-lead matters more in hair transplants than almost anywhere (patients enquire at several clinics the same night).
- The diagnosis ladder (hook → hold → click → page).
- "A free consultation isn't an offer": what real offers look like in this niche.
- Ad rules that get clinics rejected (before-and-after, "Are you balding?").
- Tracking pixels on consult forms: why it's a risk.

**Premium (community):**
- **Tier 1:** the clinic playbook, the voice agent scripts and fit rules, the follow-up sequences, the ad rules list, the creative do and don't list, and the Google keyword and negative lists.
- **Tier 2:** the build prompts in this document, run live in weekly build sessions, with the guardrail thresholds and the review-loop architecture.
- **Done for you (outside the community):** running it for a clinic. That's anryh labs itself.

**Keep private:** API keys, Business Manager and manager-account IDs, any clinic's data, and any patient's anything. Every example should come from a test account or be clearly labelled as an example.

**Before you sell it:** the engine is built and tested for insurance and roofing, but it hasn't run for a hair transplant clinic yet, and none of the clinic thresholds here have been checked against real clinic numbers. Sell it as "how it's built and why" until you have a clinic case study, and update the thresholds (cost per consult target, show rates, consult-to-deposit rates) from that clinic's real data.

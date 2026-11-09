# Speed-to-lead voice agent (ElevenLabs Agents)

Each new lead (a booking-page "call me" request, or a Meta instant-form lead) gets a call from this agent within seconds. The app places the call inline, in the same request that saved the lead (`src/lib/voice/dial.ts`), with one `POST /v1/convai/twilio/outbound-call`. Everything the agent needs comes in as dynamic variables, so there's no initiation webhook. Open times and the booking come from server tools, once the call is up.

## 1. Env vars

| Var | What |
|---|---|
| `ELEVENLABS_API_KEY` | already set (narration) |
| `ELEVENLABS_AGENT_ID` | the agent below |
| `ELEVENLABS_PHONE_NUMBER_ID` | the Twilio number imported into ElevenLabs (Agents → Phone numbers) |
| `ELEVENLABS_WEBHOOK_SECRET` | the post-call webhook's HMAC secret; also the `x-voice-secret` header on the tools |
| `ELEVENLABS_CALLER_NUMBER` | optional, E.164. Shown as "We're calling you now from …". Without it, it's looked up from ElevenLabs once per server. |
| `VOICE_LIVE_CALLS`, `VOICE_TEST_NUMBER` | dev only. Outside production nothing is dialed. Set `VOICE_LIVE_CALLS=1` with `VOICE_TEST_NUMBER=+1…` (your own phone) to get real test calls. Every call then goes to that number, never to the lead. |

Then turn on **Settings → AI voice agent** for the account. Roofers also get a "Rather talk first? We'll call you right now" form on their booking page while it's on.

## 2. Agent settings

- **Voice / TTS model:** Eleven Flash v2.5 (lowest latency). Use a natural US voice.
- **LLM:** a fast model (Gemini Flash or GPT-4o-mini class). Keep temperature low.
- **Language:** English.
- **Turn-taking:** normal eagerness. Silence end-call timeout ~20s.
- **System tools:** turn on `end_call` and `voicemail_detection`. For voicemail, leave no message (or a short one with no details), so a retry isn't wasted.
- **Max call duration:** 8 minutes.
- **Dynamic variables** (all passed with every call): `lead_id`, `first_name`, `greeting`, `company_name`, `city`, `address`, `roof_issue`, `interest`, `business`, `service_area`, `inspection_hours`, `lead_timezone`, `lead_source`. Some may be empty strings.
- **Security → Overrides:** none needed. Leave "fetch initiation client data from webhook" **off**.
- **Privacy:** call recording on (the agent announces it).

### Post-call webhook

Workspace settings → Webhooks → add `https://<APP_URL>/api/voice/post-call`, HMAC auth. Copy the secret into `ELEVENLABS_WEBHOOK_SECRET`. On the agent, turn on **post-call transcription** and **call initiation failure** events.

### Analysis → Data collection

Add these fields. They come back in the webhook and are saved on the call (`voice_calls.collected`):

| Field | Type | Description |
|---|---|---|
| `outcome` | string | One of: `booked`, `not_qualified`, `callback`, `no_answer`, `do_not_call`, `voicemail`. `booked` only if book_inspection succeeded. `callback` if they want a person to call at another time. `do_not_call` if they asked not to be called. `voicemail` if a machine answered. |
| `owns_home` | string | Yes / No / unknown |
| `in_service_area` | string | Yes / No / unknown |
| `roof_issue` | string | What's wrong with the roof, in their words |
| `roof_age` | string | Under 10 / 10–20 / Over 20 years / Not sure |
| `insurance_claim` | string | Not yet / open claim / no claim |
| `decision_makers` | string | Will everyone who decides be at the inspection? Yes / No |
| `callback_time` | string | When they asked to be called back, if they did |
| `email` | string | Their email, if given |
| `address` | string | The property address, if given |

### Server tools (webhook tools)

All are `POST`, body JSON, header `x-voice-secret: <ELEVENLABS_WEBHOOK_SECRET>` (store it as a workspace secret). Bind `lead_id` to the dynamic variable `{{lead_id}}`, so the LLM never types it.

1. **`open_times`** → `https://<APP_URL>/api/voice/tools/open_times`
   Description: "Get open inspection times. Call this before offering any time. Optionally pass a day the caller asked for."
   Body: `lead_id` (dynamic variable), `day` (string, optional, `YYYY-MM-DD` in the caller's time zone).
2. **`book_inspection`** → `https://<APP_URL>/api/voice/tools/book_inspection`
   Description: "Book the inspection at a time from open_times, once the caller has chosen it and the qualifying questions are answered."
   Body: `lead_id` (dynamic variable), `start` (string, required: the `start` value from open_times, unchanged), `name`, `email`, `address` (full street address with city), `owns_home`, `roof_issue`, `roof_age`, `insurance_claim`, `decision_makers`, `notes` (all strings, optional except address for roofers).
3. **`do_not_call`** → `https://<APP_URL>/api/voice/tools/do_not_call`
   Description: "The caller asked not to be called again. Call this right away, then apologize and end the call."
   Body: `lead_id` (dynamic variable).

Set each tool's response timeout to 10s. Turn on "disable interruptions" while `book_inspection` runs.

## 3. First message

Paste into **First message**:

```
{{greeting}}, this is the AI assistant for {{company_name}}, calling about the {{business}} request you just sent us. Just so you know, this call may be recorded. Do you have a quick minute?
```

`{{greeting}}` is "Hi Sarah", or "Hi there" when the name is unknown.

## 4. System prompt

Paste into **System prompt**:

```
# Who you are
You are the AI phone assistant for {{company_name}}, a {{business}} company. You are calling {{first_name}}, who asked us to contact them a moment ago through {{lead_source}}. Your job: confirm they're a fit, then book a free {{business}} appointment on the calendar. On a roofing call that's a free roof inspection; on a life insurance call it's a free consultation call.

You are an AI. Never claim or suggest you are a person. If they ask, say plainly: "I'm an AI assistant for {{company_name}}." You already said in your greeting that the call may be recorded. If they ask again, confirm it.

# What we know
- Name: {{first_name}} (if empty, ask who you're speaking with)
- City: {{city}}
- Address: {{address}}
- Roof issue they mentioned: {{roof_issue}}
- Interested in (insurance): {{interest}}
- Service area: {{service_area}}
- Inspection hours: {{inspection_hours}}
- Their time zone: {{lead_timezone}}

# Rules (always)
- If at any point they say anything like "stop calling", "take me off your list", "don't call me" or "not interested, don't call", call the do_not_call tool immediately, say "Understood, we won't call you again. Sorry to bother you," and end the call. Don't try to change their mind.
- If you reach voicemail or an automated system, end the call without leaving details.
- If it's the wrong number, apologize, call do_not_call, and end the call.
- Keep each turn to one or two short sentences. Ask one question at a time. Sound warm and relaxed, not salesy.
- Never quote prices, promise insurance approval, diagnose the roof, or give legal or financial advice. "The inspector will look at that and walk you through it."
- Never invent open times. Only offer times the open_times tool returned, using their label.
- If they want a person, or it's a bad time, offer to have the team call back. Ask when suits them, note it, and end politely (outcome: callback).

# Roofing call flow
1. Confirm it's a good moment. If not, ask for a better time (callback).
2. Qualify, naturally, one at a time (skip anything you already know):
   a. "Do you own the home?" If no, explain that the owner needs to request the inspection. Ask whether they can pass it on, then end (not_qualified).
   b. "What's the address of the home?" Get the street, city and ZIP. If it's clearly outside {{service_area}}, say we don't cover that area yet, and end (not_qualified).
   c. "What's going on with the roof?" (leak, storm or hail, missing shingles, age)
   d. "Roughly how old is the roof?"
   e. "Have you filed an insurance claim for it yet?"
   f. "Will everyone who'd make the decision be there for the inspection?" If not, suggest a time when they can all be there.
3. Book: say "Let me check what's open," call open_times (with a day if they asked for one), offer two options by label, and let them choose. Then ask for an email for the confirmation (optional; don't push). Call book_inspection with the chosen start exactly as returned, plus the address and the answers.
   - If it says the time was taken, call open_times again and offer new options.
   - If booking fails, tell them the team will call to confirm a time (callback).
4. Confirm the day, time and address back to them. Say the inspection is free and takes about 30–45 minutes, and the inspector will call before arriving. Thank them and end the call.

# Life insurance call flow
1. Confirm it's a good moment.
2. Ask what they'd like to protect (family, mortgage, final expenses), whether they have coverage now, and whether anyone else should join the call.
3. Book a free consultation call the same way: open_times, then book_inspection (the tool books whatever appointment the account offers).
4. Confirm the time, say the licensed agent will call them then, and end the call.
```

## 5. Testing without calling anyone

In dev (`npm run dev`, no `VOICE_LIVE_CALLS`), submitting the booking page's form logs `[voice] simulated outbound call …` and the timings. Nothing is dialed. To try the tools and the webhook:

```bash
NODE_PATH=scripts/migz/stubs npx tsx --tsconfig ./tsconfig.json scripts/voice/voice.test.mts
```

```bash
node scripts/voice/e2e.mjs
```

`voice.test.mts` checks the pure rules: the 8am–8pm window, the retries, the HMAC and the spoken times. `e2e.mjs` runs against the dev server and the real Supabase project in `.env.local`. It submits a test lead on a throwaway roofer account, calls the tools, books, posts a signed sample post-call payload, then deletes everything.

---

# Post-job check-in agent (roofers)

When a roofer marks a job done (**Job done** on the inspection's card in Clients, or the "job completed" webhook from their CRM), a second ElevenLabs agent ("Emma") calls the customer about 2 hours later, 8am to 8pm in the roofer's time zone (later ones the next morning at 10am). A no-answer is retried once the next day, then the referral email goes on its own.

The call only goes out when the customer's saved consent covers AI calls (bookings made with the "artificial or AI-generated voice" wording), they aren't on the do-not-call list, check-in calls are on in Settings, and `ELEVENLABS_CHECKIN_AGENT_ID` is set. Otherwise the customer gets the referral email only (worded "we hope it went well; if anything isn't right, reply").

People a customer refers are **never** called by either agent or texted automatically. They're saved in `customer_referrals` (never in `quote_requests`, where the voice queue looks), emailed to the roofer, sent to the roofer's CRM webhook as `event: "referral.created"`, and listed under **Referrals** in the dashboard for a call by hand.

## 1. Env vars

| Var | What |
|---|---|
| `ELEVENLABS_CHECKIN_AGENT_ID` | the check-in agent below (same phone number, same webhook secret) |

Each roofer's Google review link is set in Settings → Check-in calls and referrals (needs migration 20261204000000).

## 2. Agent settings

The same as the speed-to-lead agent (Flash v2.5, `end_call` and `voicemail_detection`, recording on, the same post-call webhook), with:

- **Name / voice:** Emma (or any natural voice; the first message says the name).
- **Max call duration:** 5 minutes.
- **Dynamic variables:** `job_id`, `first_name`, `greeting`, `customer_name`, `customer_email`, `company_name`, `address`, `reward`, `referral_goal`. `reward` is "a $100 gift card" (empty when the roofer set no reward).

### Data collection

| Field | Type | Description |
|---|---|---|
| `outcome` | string | One of: `went_well`, `issue`, `callback`, `do_not_call`, `voicemail`. `issue` if they raised any problem with the work. |
| `rating` | string | Optional. A 1–5 rating, only if they volunteer one |
| `email` | string | Their best email, if given or confirmed |
| `name` | string | Their name, if corrected |
| `feedback` | string | What they want to pass on to the company, in their words |

### Server tools

Same header (`x-voice-secret`) and 10s timeout. Bind `job_id` to `{{job_id}}`.

1. **`send_referral`** → `https://<APP_URL>/api/voice/tools/send_referral`
   Description: "The customer said the job went well and confirmed their email. Sends them the email with the Google review link and the referral link now. Then tell them what the message it returns says."
   Body: `job_id` (dynamic variable), `email` (string), `name` (string, optional), `rating` (string, optional).
2. **`report_issue`** → `https://<APP_URL>/api/voice/tools/report_issue`
   Description: "The customer raised a problem with the work. Alerts the company right away. Never offer referrals after this."
   Body: `job_id` (dynamic variable), `details` (string, what went wrong in their words), `rating` (string, optional).
3. **`do_not_call`** → `https://<APP_URL>/api/voice/tools/do_not_call`
   Description: "The customer asked not to be called again. Call this right away, then apologize and end the call."
   Body: `job_id` (dynamic variable).

## 3. First message

```
{{greeting}}, this is Emma, the virtual assistant for {{company_name}}. Just so you know, this call may be recorded. I'm just checking in to see if everything went well with your roof. Do you have a quick minute?
```

## 4. System prompt

```
# Who you are
You are Emma, the virtual assistant for {{company_name}}, a roofing company. You're calling {{first_name}} ({{customer_name}}), whose roofing job at {{address}} was just finished, to check in. You are an AI. Never claim or suggest you are a person. If they ask, say plainly: "I'm an AI assistant for {{company_name}}." You already said the call may be recorded; if they ask again, confirm it.

# Your goal
Find out whether the job went well. If it did, confirm their best email and send them an email with two links: one to leave {{company_name}} a Google review, and one to refer friends who may need roofing work (for {{reward}} after {{referral_goal}} referrals). If it didn't, make sure the company hears about it and stop there. Keep it to two or three minutes. Warm, relaxed, never salesy.

# What we know
- Customer: {{customer_name}}
- Email on file: {{customer_email}} (may be empty)
- Job address: {{address}}
- Job reference: {{job_id}}
- Referral reward: {{reward}} for {{referral_goal}} referrals (if empty, there's no reward)

# Rules (always)
- If they say anything like "stop calling", "don't call me" or "take me off your list", call do_not_call immediately, say "Understood, we won't call you again. Sorry to bother you," and end the call.
- If you hear a voicemail greeting or a beep, end the call without leaving details. If a call-screening assistant asks who's calling, say "Emma from {{company_name}}, checking in about their roofing job," and wait.
- One or two short sentences per turn. One question at a time. Don't ask for a numeric rating.
- Never promise refunds, discounts, repairs, warranty coverage or timelines. Never argue about the work. "I'll make sure the team hears that and gets back to you."
- Never ask for a positive review or a particular star rating, and never connect the gift card to the review. The review link is simply an invitation to share their experience. The gift card is only for referrals.
- If the job didn't go well, never mention the review, the referrals or the gift card.

# Call flow
1. Ask whether everything went well with the job. Nothing else first.
2. If it didn't go well, or they mention any problem (even mild, like "it was okay, but..."):
   - Apologize sincerely ("I'm really sorry to hear that"). Ask what went wrong and let them explain. One follow-up question at most.
   - Call report_issue with what they said, in their words.
   - Say someone from {{company_name}} will reach out soon. Confirm the best number or email to reach them. Thank them and end the call. Do not go on to the email, the review or the referrals.
3. If it went well:
   - Thank them warmly. Ask if there's anything they'd like passed on to the team (optional; don't push).
   - Confirm their best email. If {{customer_email}} isn't empty, read it back: "Is {{customer_email}} still the best email for you?" Otherwise ask for it and spell it back to confirm.
   - Call send_referral with their email.
   - Then tell them what the tool says to tell them: that you just emailed them a link to leave a Google review, and a link where if they refer {{referral_goal}} friends who may need roofing work, we'll send you {{reward}} to any store of their choosing. (If {{reward}} is empty, just say the link is there in case they know anyone who needs a roofer.) Use your own natural words.
   - If send_referral says it didn't go, say the team will email it shortly.
   - Thank them for choosing {{company_name}} and end the call.

# Common questions
- "Why are you calling?" → "Just checking that everything went well with your roof."
- "Can I talk to a person?" → "Of course. I'll have someone from the team call you." Note it (outcome: callback) and end politely.
- "How does the referral work?" → "The email has a link where you add their name, phone and address. Our team gives them a call. Once {{referral_goal}} are in, we send your gift card."
- "Do I have to leave a review?" → "Not at all. It's just there if you'd like to share your experience."
- "Will you call my friends with a robot?" → "No. Our team calls them personally."
- Anything about warranty, billing or repairs → "Good question, I'll have the team follow up with you on that."
```

## 5. The job completed webhook

Each roofer's URL and secret are in **Settings → Check-in calls and referrals**. In Zapier: trigger on the CRM's job status change to complete, then "Webhooks by Zapier" → POST `https://<APP_URL>/api/jobs/completed`, header `x-job-secret: <their secret>`, JSON body `{ "phone": "...", "email": "..." }` (the customer's). It matches their latest past inspection and works exactly like tapping Job done. `{ "booking_id": "..." }` also works.

## 6. Testing without calling anyone

```bash
NODE_PATH=scripts/migz/stubs npx tsx --tsconfig ./tsconfig.json scripts/voice/checkin.test.mts
```

```bash
BASE=http://localhost:3107 ELEVENLABS_WEBHOOK_SECRET=wsec_e2e_local_only CRON_SECRET=cron_e2e_local_only node scripts/voice/checkin-e2e.mjs
```

The dev server needs `ELEVENLABS_CHECKIN_AGENT_ID` (any dummy), `CRON_SECRET`, no `VOICE_LIVE_CALLS` and no `RESEND_API_KEY`. The e2e script creates a throwaway roofer with four past jobs (a happy customer, one booked before the AI wording, an unhappy one, one who never answers), runs each path, submits 5 referrals and checks the gift card, then deletes everything.

## 7. "Jobs we take" (roofers): what Emma checks before booking

Each roofer sets which jobs they accept in **Settings → Jobs you take** (also an optional step in Start here): job types, smallest job, insurance claims (either / only / none), minimum roof age for replacements, roof types, residential or commercial, homeowners only, everyone who decides at the inspection, financing, same-day leak emergencies, ZIPs or towns they won't go to, and a free-text note. Run migration `20261205000000_job_rules.sql` first. With nothing saved, every lead gets through exactly as before.

**The server decides, not the model.** Emma gathers answers; the `check_fit` tool (and `book_inspection`, which re-checks) compares them with the roofer's rules. A clear mismatch returns "not a fit": the lead is saved as `not_fit` with the reasons, the call's outcome becomes `not_qualified`, and no booking can be made. A missing or "not sure" answer never blocks: the lead can book and the roofer is told what to check.

### New webhook tool: `check_fit`

Same setup as the other tools (POST `https://<APP_URL>/api/voice/tools/check_fit`, header `x-voice-secret`, `lead_id` bound to the `{{lead_id}}` variable). Body fields, all optional strings except where noted: `roof_issue`, `job_type` (replacement, repair, inspection, gutters, siding), `roof_age`, `roof_type`, `owns_home`, `property_type` (Residential or Commercial), `insurance_claim`, `decision_makers`, `address`, `active_leak` (boolean: water coming in right now), `job_dollars` (number, only if they said a size). Description for the agent: "Check what the caller has told you against the company's rules. Call it after each answer, and again before booking. Returns whether to continue and what is still worth asking."

It returns `fits`, `urgent`, and `still_to_ask` (only the questions this roofer's rules need, e.g. roof age only when they screen replacements by age). For an active leak the roofer takes same-day, it alerts them by email and Slack and tells Emma to offer the very first slot.

### Add to Emma's system prompt (speed-to-lead agent)

```
# Fit check (always)
- After the caller tells you what's going on with the roof, call check_fit (pass what you know: roof_issue, address, and active_leak true if water is coming in right now). Then ask ONLY the questions it lists in still_to_ask, one at a time, calling check_fit again after the answers. Do not ask anything else about the job.
- If check_fit says fits is false: say, kindly and in your own words, that {{company_name}} isn't the right fit for this particular job and you're sorry you can't help. Never say why. Never mention rules or qualifications. Do not offer times or book. Thank them and end the call.
- If it says urgent is true: tell them you'll get the earliest inspection and offer the very first time from open_times (call it without a day).
- Never talk about insurance claims, free roofs or deductibles beyond asking whether they've filed a claim. Mention financing only if check_fit returned a financing note and they ask about cost or payment.
- Before book_inspection, make sure the answers you gathered are passed to it (owns_home, roof_age, roof_type, property_type, insurance_claim, decision_makers).
```

Add `check_fit` to the agent's tools. In data collection, `outcome` can stay as is: the server overrides it to `not_qualified` when it ruled the lead out.

### Booking page

The page asks the questions the rules need before the booking is confirmed (roof age, roof type, homeowner, home or business, claim, decision makers), adding any the roofer's form lacks. A clear mismatch gets a polite "not the right fit" message and no booking; "not sure" can still book, and the roofer's new-booking email says what to check, with their rules listed. Their dashboard shows the verdict and reasons on the lead or client card.

### Testing

```bash
NODE_PATH=scripts/migz/stubs npx tsx --tsconfig ./tsconfig.json scripts/voice/job-rules.test.mts
```

`e2e.mjs` also exercises `check_fit`; its with-rules half runs once migration 20261205000000 is applied.

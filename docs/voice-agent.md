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

## 3. Prompt and first message (kept in the repo)

Emma's prompt lives in `scripts/voice/emma-lead-prompt.md`, and her first message in `scripts/voice/push-emma.mjs`. Edit them there, then push:

```
node --env-file=.env.local scripts/voice/push-emma.mjs            # dry run: shows what would change
node --env-file=.env.local scripts/voice/push-emma.mjs --apply    # updates the agent, backup in .claude/emma-backups/
```

The push also removes any **workflow** (stages) on the agent. Don't add one in the ElevenLabs editor: an ElevenLabs lead-qualifier template once sat on top of the prompt, and its B2B stages (budget, authority, "route to a sales rep") made Emma re-ask questions and fire several at once. Tools are left alone.

Rules the prompt sticks to, so calls with half the details still go smoothly:
- One question per turn, the list asked once, in order, skipping anything already known or said.
- A known address is confirmed in one line ("Do you own the home at …?"). A blank one is asked once, and whatever they say is accepted.
- No coverage check when `service_area` is blank (demo calls often leave it blank).

## 4. Testing without calling anyone

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
| `email` | string | Their best email, if given or confirmed |
| `name` | string | Their name, if corrected |
| `feedback` | string | What they want to pass on to the company, in their words |

### Server tools

Same header (`x-voice-secret`) and 10s timeout. Bind `job_id` to `{{job_id}}`.

1. **`send_referral`** → `https://<APP_URL>/api/voice/tools/send_referral`
   Description: "The customer said the job went well and confirmed their email. Sends them the email with the Google review link and the referral link now. Then tell them what the message it returns says."
   Body: `job_id` (dynamic variable), `email` (string), `name` (string, optional).
2. **`report_issue`** → `https://<APP_URL>/api/voice/tools/report_issue`
   Description: "The customer raised a problem with the work. Alerts the company right away. Never offer referrals after this."
   Body: `job_id` (dynamic variable), `details` (string, what went wrong in their words).
3. **`do_not_call`** → `https://<APP_URL>/api/voice/tools/do_not_call`
   Description: "The customer asked not to be called again. Call this right away, then apologize and end the call."
   Body: `job_id` (dynamic variable).

## 3. First message

```
{{greeting}}, this is Emma, the virtual assistant for {{company_name}}. Just so you know, this call may be recorded. I'm just checking in to see if everything went well with your roof. Do you have a quick minute?
```

## 4. System prompt

The prompt lives in `scripts/voice/emma-checkin-prompt.md`. Push it (and patient turn-taking) with:

```
node --env-file=.env.local scripts/voice/push-emma.mjs --checkin           # dry run
node --env-file=.env.local scripts/voice/push-emma.mjs --checkin --apply   # backs up, then updates
```

Edit the file, not the prompt in ElevenLabs, or the next push overwrites the dashboard edit.

The call doesn't ask for or record a rating. When it went well, Emma's only job is to say an email is coming and what's in it (the Google review link and the referral link). The live agent's data collection uses `confirmed_email_address` and `client_feedback_notes`; the server reads them as `email` and `feedback`.

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

---

# Inbound Emma (roofers, +$250/month add-on)

A third ElevenLabs agent answers a roofer's **incoming** calls. Roofers opt in under **Settings → Inbound calls** and choose how calls reach her:

| Option | What the roofer does |
|---|---|
| **1. Missed calls only** (recommended) | Turns on "forward when no answer" on their own number, pointing at ours. They keep their number everywhere and still answer first. |
| **2. Every call** | Puts our number on their website, Google profile, ads and trucks. Emma answers everything. |
| **Mix** | Our number on the ads and landing page only, their own everywhere else. |

They also set a transfer number (a cell, never the forwarded line, or the call loops back to Emma), whether existing customers and urgent calls go straight to it, Emma's tone, their FAQ answers, notes, and where call summaries are emailed. Their "Jobs you take" rules apply to her bookings too.

New homeowners are qualified and booked exactly like a form lead (they become a `quote_requests` row with `source = 'phone'`, so `open_times`, `check_fit`, `book_inspection` and `do_not_call` work unchanged). Existing customers, suppliers and everyone else get a message taken or a transfer; their temporary lead is deleted after the call. Every call except spam is emailed to the roofer.

## 1. Run the migration

`supabase/migrations/20261218000000_inbound_calls.sql` (agents' inbound columns, `inbound_calls` table, `phone` as a lead source).

## 2. Create the agent in ElevenLabs

1. Duplicate the speed-to-lead agent (same voice, Flash v2.5, LLM, temperature, recording on), name it "Emma (inbound)".
2. Copy its id into `ELEVENLABS_INBOUND_AGENT_ID` (Vercel and `.env.local`), then push the prompt and first message:
   ```
   node --env-file=.env.local scripts/voice/push-emma.mjs --inbound            # dry run
   node --env-file=.env.local scripts/voice/push-emma.mjs --inbound --apply
   ```
3. **Tools:** the same four webhook tools as the speed-to-lead agent (`open_times`, `check_fit`, `book_inspection`, `do_not_call`, each with `lead_id` bound to `{{lead_id}}`), plus the system tools `end_call` and **`transfer_to_number`**: one rule, destination `{{transfer_number}}`, condition "the caller should be connected to the team, as the prompt says". Use the Twilio conference (warm) transfer so the team hears who it is. `voicemail_detection` isn't needed.
4. **Dynamic variables** (all come from the initiation webhook): `lead_id`, `inbound_call_id`, `company_name`, `service_area`, `inspection_hours`, `lead_timezone`, `caller_number_known`, `transfer_number`, `can_transfer`, `transfer_existing`, `transfer_urgent`, `tone`, `company_faqs`, `company_notes`, `line_ready`.
5. **Security:** turn on "Fetch conversation initiation data for inbound Twilio calls". No overrides needed.
6. **Workspace webhooks:** add the conversation initiation webhook `https://<APP_URL>/api/voice/inbound`, `POST`, with the header `x-voice-secret: <ELEVENLABS_WEBHOOK_SECRET>` (the workspace secret the tools already use). The post-call webhook is the same one as the other agents (`/api/voice/post-call`); turn on post-call transcription for this agent.
7. **Max call duration:** 8 minutes. Silence end-call timeout ~20s.

### Data collection

| Field | Type | Description |
|---|---|---|
| `caller_type` | string | One of: `new_customer`, `existing_customer`, `vendor`, `spam`, `other`. `vendor` for suppliers, adjusters, other contractors. |
| `outcome` | string | One of: `booked`, `message`, `transferred`, `not_qualified`, `callback`, `do_not_call`. `message` when you took a message. |
| `caller_name` | string | The caller's name, if given |
| `message` | string | The message for the team, in one or two sentences, if one was taken |
| `callback_time` | string | When they want a call back, if they said |
| `email` | string | Their email, if given |
| `address` | string | The property or job address, if given |
| `roof_issue` | string | What's going on with the roof, in their words |
| `roof_age`, `owns_home`, `insurance_claim`, `decision_makers` | string | As on the speed-to-lead agent |

The server checks `outcome` against what really happened (a booking exists, do-not-call, a transfer, a caller who never spoke).

## 3. Per roofer (when they opt in)

You get a Slack alert. Then:
1. Buy a local Twilio number in their area code (Twilio console → Phone numbers).
2. Import it into ElevenLabs (Agents → Phone numbers → Import from Twilio) and assign it to **Emma (inbound)**.
3. Enter it on **/admin/inbound**. Their Settings page then shows the number and, for option 1, the forwarding codes for their carrier.
4. Call it yourself once to hear Emma as their company.

Bill the $250 by hand for now (it isn't added to their Stripe subscription automatically). /admin/inbound shows each roofer's last 30 days of calls, bookings and minutes.

## 4. Compliance

Washington (and other all-party consent states) need everyone's consent to record: the first message says the call may be recorded. Inbound callers aren't added to any calling list; a booking's confirmation emails go out as for any booking. Text summaries wait for A2P 10DLC approval; summaries are email only.

## 5. Testing without a phone

```bash
NODE_PATH=scripts/migz/stubs npx tsx --tsconfig ./tsconfig.json scripts/voice/inbound.test.mts
```

Checks the variables, the call classification and the summary email.

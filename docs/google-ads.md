# Google Ads, run by Migz

Roofers can add Google Search ads next to their Meta ads. The Google Ads account is theirs, and they pay Google directly with their own card. Anryh Labs manages it from our Google Ads manager account (MCC). Migz builds the campaign and then runs it every day within guardrails.

## One-time setup (Anryh Labs)

1. **Manager account.** Create a Google Ads manager account at ads.google.com/home/tools/manager-accounts. Its 10-digit id goes in `GOOGLE_ADS_MANAGER_ID`.
2. **Developer token.** In the manager account, open Admin → API Center and apply for a token (`GOOGLE_ADS_DEVELOPER_TOKEN`).
   - It starts with test access, which only reaches test accounts.
   - Apply for Basic access when the tool is described and ready. Approval takes days to a few weeks.
3. **OAuth client.** In Google Cloud, create an OAuth client (type "Web application" or "Desktop") and enable the Google Ads API. Set `GOOGLE_ADS_CLIENT_ID` and `GOOGLE_ADS_CLIENT_SECRET`.
4. **Refresh token.** Sign in once, as a user with access to the manager account, with the scope `https://www.googleapis.com/auth/adwords` (for example through Google's OAuth Playground with your own client). Save the result in `GOOGLE_ADS_REFRESH_TOKEN`.
5. **Optional settings:**
   - `GOOGLE_ADS_API_VERSION` (default `v22`). Google retires each version after about a year; bump it when Google announces a sunset.
   - `GOOGLE_ADS_VALIDATE_ONLY=1` makes Google check every change without making it. `MIGZ_TEST_MODE=1` does the same.
6. **Migration.** Run `supabase/migrations/20261214000000_google_ads.sql`.

Until all of the keys above are set, the setup step still saves the roofer's account and alerts staff in Slack, so it can be linked by hand. Migz does nothing in Google until the API is configured.

## What the roofer does (Start here → Google Ads, optional)

- **They already have an account:** they enter their customer ID and monthly Google budget.
  - We send a link request from the manager account.
  - They accept it in Google Ads under Admin → Access and security → Managers, then press **Check again**.
- **They don't have one:** they enter the Google email that should own it.
  - We create the account under our manager account, and Google emails them an invitation as admin.
  - They accept it and add their card under Billing.
- **Monthly budget:** at least $1,000, $1,500 recommended. Roofing clicks often cost $15 to $50+. The budget is a hard cap that Migz never budgets past, and it's separate from their Meta ad funds.
- **Dashboard → Google Ads** shows the last 30 days and the changes waiting for approval. It's also where they change the cap, switch Google off, set their average job value, and see everything Migz changed.

## What Migz does (hourly cron, `src/lib/google-ads/review.ts`)

1. **Link check.** A pending link is checked each hour until it's accepted.
2. **Build, once the roofer's campaign has started** (`build.ts`):
   - Turns on auto-tagging, so every click carries a gclid.
   - Creates three conversion actions:
     - "Booked inspection" (uploaded, used for bidding)
     - "Call from ad, 60s+" (used for bidding)
     - "Closed roofing job" (uploaded with its value, reported only)
   - Creates one Search campaign with these settings:
     - Google Search only: no search partners, no Display.
     - People *located in* their radius, not people "interested in" it.
     - English only.
     - Maximize conversions.
     - Daily budget = monthly cap / 30.4.
     - UTM tags on every click.
   - One ad group for each kind of job they take: replacement, repair, storm/hail (only if they take insurance claims), inspection, gutters, siding. Each has phrase and exact keywords (including city keywords) and a responsive search ad with up to 15 headlines and 4 descriptions built from their facts: special, certifications, warranty, offer and city.
   - About 60 starting negatives: job seekers, DIY, supplies, other kinds of "roof", and anything their job rules exclude (jobs they don't take, roof types they don't do, residential or commercial, insurance claims, excluded towns).
   - A call asset with their number, and callouts.
3. **Sync** (`sync.ts`): campaigns with impression share (including impression share lost to budget and to rank), ad groups, keywords with quality score, the last 14 days of search terms, ads with ad strength and approval, negatives, and daily rows.
4. **Spend control, enforced in code:**
   - The daily budget is never above the cap.
   - The campaign pauses when the month's spend reaches the cap, or when the roofer switches Google or all ads off.
   - It turns back on next month only if Migz was the one that paused it.
5. **Conversions** (`conversions.ts`):
   - Bookings from a Google click (gclid, gbraid or wbraid saved from the page URL) are uploaded as "Booked inspection".
   - When the job is marked done (the Job done button or the CRM webhook), it's uploaded again as "Closed roofing job" with their average job value (default $12,000).
   - Hashed email and phone are included (enhanced conversions for leads).
6. **Daily review** (Claude with the tools in `tools.ts`, instructions in `playbook.ts` REVIEW_INSTRUCTIONS):
   - **Search terms every day:** block what isn't a local roofing customer, and add converting searches as exact keywords.
   - **Keywords:** pause a keyword that spent 2x the target cost per conversion (or $250 with no target yet) with no conversion and at least 15 clicks.
   - **Ads:** keep 2–3 ads per group, pause clear underperformers after 1,500 impressions, and write replacements that borrow what the winning ad says.
   - **Budget:** raise it only when the account is converting at or under target *and* losing 10%+ of impression share to budget. Each change is at most 25%, at least 3 days apart, and never above the cap.
   - **Bidding:** start on Maximize conversions. Move to a target cost per conversion once there are 15+ conversions in 30 days, never below 80% of the actual cost per conversion. Change bidding at most every 14 days, and never in the first week.
   - **First 7 days:** negatives and fixes only.

   Every call goes through `guardrails.ts`. A rejected call tells Migz why, so it can try again within the rules. Ad text is checked against Google's limits (30 and 90 characters, no "!", no words in all caps) and the roofing claims we never make (a free roof, insurance paying, financing, the deductible).
7. **Ask-first roofers:**
   - These go ahead on their own: blocking searches, pausing losers, and lowering the budget.
   - These wait on the Google Ads page for approval, with a Slack DM: new keywords, new ads, budget increases and bidding changes.
   - On approval, each change is checked again against the latest numbers before it's made.

Applied changes also appear in the roofer's activity feed, prefixed "Google Ads:".

## Files

`src/lib/google-ads/`:

- `api.ts`: REST client
- `account.ts`: linking and account creation
- `build.ts`: the campaign build
- `sync.ts`: pulling the numbers
- `review.ts`: the hourly run
- `tools.ts`, `guardrails.ts`, `executor.ts`: what Migz can do, the checks, and applying changes
- `conversions.ts`: sending conversions to Google
- `playbook.ts`: keywords, negatives, ad text, thresholds and the review instructions
- `ids.ts`, `types.ts`

UI:

- `src/components/dashboard/GoogleAdsSetup.tsx`
- `src/components/dashboard/GoogleProposals.tsx`
- `src/app/dashboard/google/` (page and actions)

Tests: `scripts/migz/google-ads.test.mts`.

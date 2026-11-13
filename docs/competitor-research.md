# Competitor research (/admin/competitors)

Migz studies a roofer's competitors and writes ads that beat them. It follows the steal-competitor-ads process (a copy is in `reference/`, which is gitignored), adapted for roofing, to the roofer's own service area, and to our app.

**Setup**

- Put the Apify key in `APIFY_API`. `APIFY_TOKEN` and `APIFY_GOOGLE_ADS_API_KEY` are also read.
- Run `supabase/migrations/20261215000000_competitor_research.sql`.
- Publishing the ad also needs the Google Ads setup in `docs/google-ads.md`.

**How to run it**

Pick a roofer, set the Apify budget (spend stops there) and the benchmark market (default Dublin, Ireland), then press Run research. The page moves the run along while it's open, and the hourly Migz cron keeps it going when it isn't. A full run takes about 15 to 40 minutes.

## The steps (`src/lib/competitors/pipeline.ts`)

1. **Google Maps.** The top 50 roofers in the roofer's service area and in the benchmark market (`compass/crawler-google-places`). The roofer themself is left out.
2. **Their websites.** Each competitor's homepage is read for the Facebook Page it links to. Facebook itself is never opened.
3. **Their ads.**
   - Google: every ad per competitor domain, from Google's Ads Transparency Center (`solidcode/ads-transparency-scraper`), with dates and, in Europe, impression ranges.
   - Facebook and Instagram: every active ad per Page, sorted by impressions, from Meta's Ad Library (`apify/facebook-ads-scraper`). In Europe this includes reach.
4. **Reading.**
   - Google text ads arrive as pictures, so a small vision model reads their headline, description and display URL.
   - Then the page behind every ad is read.
5. **Ranking** (`rank.ts`). Best to worst, separately for each market and platform:

   | | Google | Meta |
   |---|---|---|
   | The roofer's area | days running | Meta's impressions order |
   | Benchmark market | impressions a day | reach a day |

   - **Left out:** ads under 14 days old, ads whose landing page can't be found, hiring posts, Local Services and Maps ads, and copies (counted once; the copies add to the ad's count).
   - **Top Rated:** the best 15% of each list, never fewer than 3.
   - **Best Offers:** every real offer (a price, money off, something free, a guarantee, a speed promise), ranked by a harsh buyer regardless of the ad's delivery. A free quote, a free inspection, "call now" or a phone number is not an offer.
6. **Your business** (`context.ts`). The roofer's website (home page plus up to 10 pages), their Google reviews (`compass/google-maps-reviews-scraper`, 40 newest), testimonials on the site, and videos (site embeds plus their uploaded clips). From these it writes:
   - **Can claim:** the offer, the promises and the numbers, each with its source.
   - **Hold:** true but too weak to use.
   - **Never say.**
   - **The gap:** what the ads can't claim yet.

   The result is saved to `agent_ad_context`.
7. **The ads** (`writer.ts`, `gates.ts`, `scoring.ts`). 150 headlines and 40 descriptions, then three filters:
   1. **The rules** (code):
      - Google's lengths.
      - Banned words, and the roofing claims we never make.
      - Every number and claim word must appear in the roofer's proof.
      - No competitor names, phone numbers, symbols or all caps, and no "!" in a headline.
   2. **The harsh buyer** (a separate model call). Each line goes up against three of the competitors' winning lines, with brand names stripped and the order shuffled. Ours has to be picked in 4 of 5 runs. Lines that lose are rewritten from the buyer's reasons, for up to 3 rounds.
   3. **Variety.** Near-copies are dropped, and no angle takes more than a third of the kept lines. The 15 kept headlines must cover at least 4 of the 6 angles: offer, speed, price, trust, risk-reversal, ask.

   The 15 strongest headlines and the 4 strongest descriptions make one responsive search ad.
8. **Ours vs theirs.** The finished ad goes against each competitor winner in a blind A/B test, and the landing page draft against their pages. The ad is publishable only if the judge is 9/10 or more sure ours wins against every one.

## Publishing (`publish.ts`)

"Add to Google Ads, paused" only works when the 9/10 gate passed and the roofer's Google Ads account is linked. It never enables anything and never edits what's already there.

- **No Migz campaign yet:** builds the full campaign, PAUSED, with this ad in every ad group.
- **A Migz campaign already exists:** adds this ad to each of its ad groups, paused.

## What Migz does with it (`intel.ts`)

The latest research goes into the snapshot Migz's Meta reviews read and into the Google Ads daily review, as `competitor_research`. It contains:

- the competitors' best offers and winning ads, to beat and never to copy;
- what the roofer can claim and can't;
- their best review quotes;
- the headlines that passed the gate.

## The admin page

- **Who advertises:** every competitor in each market, with how many Google and Meta ads they run.
- **Ads:** All, Top Rated or Best Offers, with Google and Facebook in separate sections, filterable by market.
- **Your business:** the claims, gap, reviews, testimonials and videos.
- **Ours vs theirs:**
  - the verdict;
  - how many headlines passed each filter;
  - the ad and the landing page;
  - each matchup side by side;
  - all of the headlines and descriptions, each marked passed or failed with the reason.
- **Published:** add the ad to Google Ads, paused.

import { DEMO_MAILTO, SiteFooter, SiteHeader, SiteShell } from "@/components/site/SiteChrome";
import { GlassHero } from "@/components/site/GlassHero";
import { Board } from "@/components/site/Board";
import { CreativeCycle } from "@/components/site/CreativeCycle";
import { Diagnose } from "@/components/site/Diagnose";
import { SignalChain } from "@/components/site/SignalChain";
import { BrainPreview } from "@/components/site/BrainPreview";
import { SlipFile } from "@/components/site/SlipFile";
import { PhoneStory } from "@/components/site/PhoneStory";
import { Limits } from "@/components/site/Limits";
import Link from "next/link";
import { FaqList } from "@/components/site/FaqList";
import { JsonLd, faqLd } from "@/components/site/JsonLd";
import { PricingCovers, PricingExample, PricingTiers } from "@/components/site/PricingBlock";
import { HOME_FAQS } from "@/lib/seo/faqs";
import { INSURANCE_TYPES } from "@/lib/seo/insurance-types";
import { PRICING_SUMMARY } from "@/lib/pricing";
import { absoluteUrl } from "@/lib/site";
import "@/components/site/content.css";

const VERTICALS = [
  {
    name: "roofing companies",
    goal: "booked free roof inspections",
    lead: "ads reach homeowners around your service area and book them straight into your crews’ calendar.",
    points: [
      "radius targeting: homeowners within 15 to 50 miles of you",
      "booking page asks the address, homeowner, roof issue and roof age",
      "books two inspections at once if you run two crews",
      "an email per inspection with a postcard and door hanger for that street",
      "a reminder the morning of, and each booking sent to your crm",
      "ads never promise a free roof or to cover a deductible",
    ],
    start: ["$1,000/month for migz ai, no setup fee", "at least $2,000 in meta ad spend for the first month, all of it to your ads"],
  },
  {
    name: "life insurance agents",
    goal: "booked calls and leads",
    lead: "ads reach people shopping for coverage in the states you’re licensed in and put them on a call with you.",
    points: [
      "final expense, whole life, mortgage protection, term and more",
      "an instant form or your booking page, your choice",
      "a slack ping the moment a lead comes in",
      "follow-up emails when you tap tried to call",
      "runs inside meta’s rules for financial products ads",
    ],
    start: null,
  },
];

export default function Home() {
  return (
    <SiteShell>
      <JsonLd
        data={[
          {
            "@context": "https://schema.org",
            "@type": "Organization",
            name: "anryh labs",
            url: absoluteUrl(),
            logo: absoluteUrl("/anryh-labs-logo.png"),
            email: "anryhlabs@gmail.com",
            description:
              "anryh labs makes migz ai, an ai media buyer that runs meta (facebook and instagram) ads for roofing companies and independent life insurance agents.",
          },
          { "@context": "https://schema.org", "@type": "WebSite", name: "anryh labs", url: absoluteUrl() },
          faqLd(HOME_FAQS),
        ]}
      />
      <SiteHeader />
      <main>
        <GlassHero />

        <div className="sb-deep">
          <section className="sb-sec" aria-labelledby="what-h">
            <h2 className="sb-h2" id="what-h" data-reveal>
              what is migz ai?
            </h2>
            <p className="cx-answer">
              migz ai is an ai media buyer for <b>roofing companies</b> and <b>independent life insurance agents</b>, made by
              anryh labs. it runs your whole meta (facebook and instagram) ad campaign: it makes the ads, sends people to your
              booking page, tells you the moment someone books, and reads the numbers every day to fix what holds results back.
            </p>
          </section>

          <section className="sb-sec" id="who" aria-labelledby="who-h">
            <h2 className="sb-h2" id="who-h" data-reveal>
              who we run meta ads for.
            </h2>
            <ul className="cx-verts">
              {VERTICALS.map((v) => (
                <li key={v.name}>
                  <small>{v.goal}</small>
                  <b>{v.name}</b>
                  <p>{v.lead}</p>
                  <ul>
                    {v.points.map((p) => (
                      <li key={p}>{p}</li>
                    ))}
                  </ul>
                  {v.start && (
                    <div className="cx-verts__start">
                      <small>to start</small>
                      {v.start.map((s) => (
                        <strong key={s}>{s}</strong>
                      ))}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </section>

          <section className="sb-sec" aria-labelledby="board-h">
            <h2 className="sb-h2" id="board-h" data-reveal>
              your whole campaign, live.
            </h2>
            <Board />
          </section>

          <section className="sb-sec" aria-labelledby="reads">
            <h2 className="sb-h2" id="reads" data-reveal>
              it reads the numbers, then fixes the campaign.
            </h2>
            <Diagnose />
            <p className="sb-note" style={{ marginTop: 16 }}>
              sample reads with illustrative numbers. migz ai checks results through the day, acts within your limits, and
              when the right move is to wait, it says so.
            </p>
          </section>

          <section className="sb-sec" aria-labelledby="calls">
            <h2 className="sb-h2" id="calls" data-reveal>
              bookings, not clicks.
            </h2>
            <div className="calls">
              <SignalChain />
              <BrainPreview />
            </div>
          </section>

          <section className="sb-sec" aria-labelledby="slips">
            <h2 className="sb-h2" id="slips" data-reveal>
              every move comes with a reason.
            </h2>
            <SlipFile />
            <p className="sb-note" style={{ marginTop: 16 }}>
              sample activity, written the way migz ai writes it in your dashboard.
            </p>
          </section>

          <section className="sb-sec" aria-labelledby="creatives">
            <h2 className="sb-h2" id="creatives" data-reveal>
              10 to 13 ads at launch. better ones every cycle.
            </h2>
            <CreativeCycle />
            <p className="sb-note" style={{ marginTop: 16 }}>
              illustration. how many ads launch depends on your daily budget and lead style.
            </p>
          </section>

          <section className="sb-sec" id="how" aria-labelledby="how-h">
            <h2 className="sb-h2" id="how-h" data-reveal>
              from ad to your morning slack.
            </h2>
            <PhoneStory />
            <p className="sb-note" style={{ marginTop: 16 }}>
              the first three screens are a live booking page. the slack notification is a sample.
            </p>
          </section>

          <section className="sb-sec" id="limits" aria-labelledby="limits-h">
            <h2 className="sb-h2" id="limits-h" data-reveal>
              hard limits it can’t cross.
            </h2>
            <Limits />
          </section>

          <section className="sb-sec" id="coverage" aria-labelledby="coverage-h">
            <h2 className="sb-h2" id="coverage-h" data-reveal>
              every kind of life insurance you sell.
            </h2>
            <ul className="cx-types">
              {INSURANCE_TYPES.map((t) => (
                <li key={t.slug}>
                  <Link href={`/life-insurance-ads/${t.slug}`}>
                    <b>{t.name}</b>
                    <span>{t.buyers}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>

          <section className="sb-sec" id="pricing" aria-labelledby="pricing-h">
            <h2 className="sb-h2" id="pricing-h" data-reveal>
              simple pricing.
            </h2>
            <p className="sb-note" style={{ marginBottom: 12 }}>
              <b>roofing companies:</b> $1,000 a month for migz ai with no setup fee, and at least $2,000 in meta ad spend for the first
              month.
            </p>
            <p className="sb-note" style={{ marginBottom: 24 }}>
              <b>life insurance agents:</b> {PRICING_SUMMARY}
            </p>
            <PricingTiers />
            <PricingExample />
            <PricingCovers />
            <p className="cx-links">
              <Link href="/pricing">see the full pricing and a calculator</Link>
            </p>
          </section>

          <section className="sb-sec" id="faq" aria-labelledby="faq-h">
            <h2 className="sb-h2" id="faq-h" data-reveal>
              questions, answered.
            </h2>
            <FaqList faqs={HOME_FAQS} />
            <p className="cx-links">
              <Link href="/blog">read the blog</Link>
              <Link href="/life-insurance-ads">life insurance ads by coverage type</Link>
            </p>
          </section>

          <section className="sb-close" aria-labelledby="close-h">
            <h2 className="sb-h2" id="close-h">
              ask for an invite.
            </h2>
            <a href={DEMO_MAILTO} className="sb-cta">
              reach out
            </a>
            <p className="sb-invite">invite only. tell us your trade, your area and your monthly ad budget and we’ll reply.</p>
          </section>
        </div>
      </main>
      <SiteFooter />
    </SiteShell>
  );
}

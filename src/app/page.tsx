import { DEMO_MAILTO, SiteFooter, SiteHeader, SiteShell } from "@/components/site/SiteChrome";
import { GlassHero } from "@/components/site/GlassHero";
import { Board } from "@/components/site/Board";
import { Examples } from "@/components/site/Examples";
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
              "anryh labs makes migz ai, an ai media buyer that runs meta (facebook and instagram) ads for independent life insurance agents.",
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
              migz ai is an ai media buyer for independent life insurance agents, made by anryh labs. it runs your whole meta
              (facebook and instagram) ad campaign for final expense, whole life, mortgage protection, term life and more: it makes
              the ads, sends people to a lead form or your booking page, tells you on slack the moment a lead comes in, and reads
              the numbers every day to fix what holds results back.
            </p>
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
              calls, not clicks.
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
              creative is one lever. it makes the video too.
            </h2>
            <Examples />
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
              simple pricing. no monthly fee.
            </h2>
            <p className="sb-note" style={{ marginBottom: 24 }}>
              {PRICING_SUMMARY}
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
            <p className="sb-invite">invite only. tell us your state and monthly ad budget and we’ll reply.</p>
          </section>
        </div>
      </main>
      <SiteFooter />
    </SiteShell>
  );
}

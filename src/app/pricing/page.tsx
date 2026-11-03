import type { Metadata } from "next";
import { Bullets, ContentPage, Crumbs, H1, H2, InviteLine } from "@/components/site/ContentPage";
import { FaqList } from "@/components/site/FaqList";
import { FeeCalculator } from "@/components/site/FeeCalculator";
import { JsonLd, breadcrumbLd, faqLd } from "@/components/site/JsonLd";
import { PricingCovers, PricingExample, PricingTiers } from "@/components/site/PricingBlock";
import { PRICING_SUMMARY, SETUP_FEE, TIERS, pct, sliceLabel } from "@/lib/pricing";
import { PRICING_FAQS } from "@/lib/seo/faqs";
import { absoluteUrl, pageMeta } from "@/lib/site";

export const metadata: Metadata = pageMeta({
  title: "pricing · anryh labs · ai meta ads for life insurance agents",
  description:
    "anryh labs pricing: a one-time $750 setup fee, no monthly fee, then 25% down to 12% of the ad funds you add. covers operations, creative generation and automation.",
  path: "/pricing",
});

export default function PricingPage() {
  return (
    <ContentPage>
      <JsonLd
        data={[
          {
            "@context": "https://schema.org",
            "@type": "Service",
            name: "migz ai ad automation for life insurance agents",
            serviceType: "meta (facebook and instagram) ad management and creative generation for insurance agents",
            provider: { "@type": "Organization", name: "anryh labs", url: absoluteUrl() },
            areaServed: "US",
            url: absoluteUrl("/pricing"),
            description: PRICING_SUMMARY,
            offers: [
              { "@type": "Offer", name: "one-time setup", price: String(SETUP_FEE), priceCurrency: "USD" },
              ...TIERS.map((t, i) => ({
                "@type": "Offer",
                name: `management fee: ${pct(t.rate)} of ${sliceLabel(i)}`,
                description: `${pct(t.rate)} of ${sliceLabel(i)}, counting everything added across all deposits. covers operations, creative generation and automation.`,
                priceCurrency: "USD",
              })),
            ],
          },
          faqLd(PRICING_FAQS),
          breadcrumbLd([
            { name: "home", url: absoluteUrl() },
            { name: "pricing", url: absoluteUrl("/pricing") },
          ]),
        ]}
      />

      <Crumbs items={[{ name: "home", href: "/" }, { name: "pricing" }]} />
      <H1>pricing</H1>
      <p className="cx-answer">
        <b>the short answer:</b> {PRICING_SUMMARY}
      </p>

      <H2 id="rates">how the percentage works</H2>
      <p>
        it&apos;s a flat 20% until you&apos;ve added $20,000 in total. the moment your total passes $20,000, the fee drops to 12% on everything you add after
        that. the first $20,000 always stays at 20%. the fee is kept from each amount you add, and the rest is your ad budget.
      </p>
      <PricingTiers />
      <PricingExample />

      <H2 id="covers">what you get</H2>
      <PricingCovers />

      <H2 id="calculator">try an amount</H2>
      <FeeCalculator />

      <H2 id="no-guarantees">what we promise, and what we don&apos;t</H2>
      <Bullets
        items={[
          "no promise of leads, appointments or sales. nobody can honestly make one.",
          "every change migz ai makes comes with a reason you can read in your dashboard.",
          "migz ai can't spend past your budget or cross the hard limits you set.",
          "the ads run in your own meta ad account, the leads are yours, and you can remove access any time.",
        ]}
      />

      <H2 id="questions">questions about pricing</H2>
      <FaqList faqs={PRICING_FAQS} />

      <InviteLine />
    </ContentPage>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { Bullets, ContentPage, Crumbs, H1, H2, InviteLine } from "@/components/site/ContentPage";
import { JsonLd, breadcrumbLd } from "@/components/site/JsonLd";
import { INSURANCE_TYPES } from "@/lib/seo/insurance-types";
import { absoluteUrl, pageMeta } from "@/lib/site";

export const metadata: Metadata = pageMeta({
  title: "life insurance ads by coverage type · anryh labs",
  description:
    "migz ai runs facebook and instagram ads for final expense, whole life, mortgage protection, term life, iul, income protection, policy reviews and coverage beyond work.",
  path: "/life-insurance-ads",
});

export default function CoverageIndex() {
  return (
    <ContentPage>
      <JsonLd
        data={[
          {
            "@context": "https://schema.org",
            "@type": "ItemList",
            name: "types of life insurance migz ai can advertise",
            itemListElement: INSURANCE_TYPES.map((t, i) => ({ "@type": "ListItem", position: i + 1, name: t.name, url: absoluteUrl(`/life-insurance-ads/${t.slug}`) })),
          },
          breadcrumbLd([
            { name: "home", url: absoluteUrl() },
            { name: "life insurance ads", url: absoluteUrl("/life-insurance-ads") },
          ]),
        ]}
      />
      <Crumbs items={[{ name: "home", href: "/" }, { name: "life insurance ads" }]} />
      <H1>life insurance ads, by coverage type</H1>
      <p className="cx-answer">
        <b>the short answer:</b> migz ai can run meta (facebook and instagram) ads for {INSURANCE_TYPES.map((t) => t.name).join(", ")}. you pick up to three as your focus, in order, and it aims new ads at them.
      </p>
      <H2>pick a coverage type</H2>
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
      <H2>what stays the same for every type</H2>
      <Bullets
        items={[
          "image and video ads made for you, tested against each other and refreshed as they wear out",
          "an instant form, a booking page or both, in the states you're licensed in",
          "a slack message the moment a lead comes in, and optional follow-up emails when you tap tried to call",
          "hard limits it can't cross, and a plain reason for every change",
          "copy that never tells the viewer their age, health or finances and never promises rates, returns or approval",
        ]}
      />
      <InviteLine />
    </ContentPage>
  );
}

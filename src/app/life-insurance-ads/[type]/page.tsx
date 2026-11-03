import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Bullets, ContentPage, Crumbs, H1, H2, InviteLine } from "@/components/site/ContentPage";
import { FaqList } from "@/components/site/FaqList";
import { JsonLd, breadcrumbLd, faqLd } from "@/components/site/JsonLd";
import { postBySlug } from "@/lib/blog/posts";
import { PRICING_SUMMARY } from "@/lib/pricing";
import { INSURANCE_TYPES, typeBySlug } from "@/lib/seo/insurance-types";
import { absoluteUrl, pageMeta } from "@/lib/site";

type Props = { params: Promise<{ type: string }> };

export const dynamicParams = false;
export const generateStaticParams = () => INSURANCE_TYPES.map((t) => ({ type: t.slug }));

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const t = typeBySlug((await params).type);
  if (!t) return {};
  return pageMeta({
    title: `${t.headline} · anryh labs`,
    description: `${t.answer} built for independent life insurance agents.`,
    path: `/life-insurance-ads/${t.slug}`,
  });
}

export default async function CoverageTypePage({ params }: Props) {
  const t = typeBySlug((await params).type);
  if (!t) notFound();
  const path = `/life-insurance-ads/${t.slug}`;
  const faqs = [...t.faqs, { q: `how much does it cost to run ${t.name} ads with migz ai?`, a: PRICING_SUMMARY }];
  const posts = t.posts.map(postBySlug).filter((p) => !!p);

  return (
    <ContentPage>
      <JsonLd
        data={[
          {
            "@context": "https://schema.org",
            "@type": "Service",
            name: `${t.name} ad automation`,
            serviceType: `meta ad management for ${t.name} insurance agents`,
            provider: { "@type": "Organization", name: "anryh labs", url: absoluteUrl() },
            areaServed: "US",
            url: absoluteUrl(path),
            description: t.answer,
          },
          faqLd(faqs),
          breadcrumbLd([
            { name: "home", url: absoluteUrl() },
            { name: "life insurance ads", url: absoluteUrl("/life-insurance-ads") },
            { name: t.name, url: absoluteUrl(path) },
          ]),
        ]}
      />
      <Crumbs items={[{ name: "home", href: "/" }, { name: "life insurance ads", href: "/life-insurance-ads" }, { name: t.name }]} />
      <H1>{t.headline}</H1>
      <p className="cx-answer">
        <b>the short answer:</b> {t.answer}
      </p>

      <H2>who buys {t.name}</H2>
      <p>{t.buyers}</p>

      <H2>what the ads look like</H2>
      <Bullets items={t.ads} />

      <H2>what migz ai does</H2>
      <Bullets items={t.migz} />

      <H2>what the ads can&apos;t say</H2>
      <p>{t.rules}</p>

      <H2>what it costs</H2>
      <p>
        {PRICING_SUMMARY} see the full <Link href="/pricing">pricing</Link>.
      </p>

      <H2>questions about {t.name} ads</H2>
      <FaqList faqs={faqs} />

      {posts.length > 0 && (
        <>
          <H2>keep reading</H2>
          <ul className="cx-posts">
            {posts.map((p) => (
              <li key={p.slug}>
                <Link href={`/blog/${p.slug}`}>
                  <b>{p.title}</b>
                  <span>{p.description}</span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}

      <H2>other coverage types</H2>
      <ul className="cx-links" style={{ listStyle: "none", padding: 0 }}>
        {INSURANCE_TYPES.filter((o) => o.slug !== t.slug).map((o) => (
          <li key={o.slug}>
            <Link href={`/life-insurance-ads/${o.slug}`}>{o.name}</Link>
          </li>
        ))}
      </ul>

      <InviteLine />
    </ContentPage>
  );
}

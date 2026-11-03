import type { Metadata } from "next";
import Link from "next/link";
import { ContentPage, Crumbs, H1, InviteLine } from "@/components/site/ContentPage";
import { JsonLd, breadcrumbLd } from "@/components/site/JsonLd";
import { POSTS } from "@/lib/blog/posts";
import { absoluteUrl, pageMeta } from "@/lib/site";

export const metadata: Metadata = pageMeta({
  title: "blog · facebook ads for life insurance agents · anryh labs",
  description: "plain answers for life insurance agents on facebook and instagram ads: costs, lead forms, follow-up, compliance and ai ad automation.",
  path: "/blog",
});

export default function BlogIndex() {
  return (
    <ContentPage>
      <JsonLd
        data={[
          {
            "@context": "https://schema.org",
            "@type": "Blog",
            name: "anryh labs blog",
            url: absoluteUrl("/blog"),
            blogPost: POSTS.map((p) => ({ "@type": "BlogPosting", headline: p.title, url: absoluteUrl(`/blog/${p.slug}`), datePublished: p.date })),
          },
          breadcrumbLd([
            { name: "home", url: absoluteUrl() },
            { name: "blog", url: absoluteUrl("/blog") },
          ]),
        ]}
      />
      <Crumbs items={[{ name: "home", href: "/" }, { name: "blog" }]} />
      <H1>the blog</H1>
      <p>plain answers for life insurance agents on facebook and instagram ads.</p>
      <ul className="cx-posts">
        {POSTS.map((p) => (
          <li key={p.slug}>
            <Link href={`/blog/${p.slug}`}>
              <b>{p.title}</b>
              <span>{p.description}</span>
            </Link>
          </li>
        ))}
      </ul>
      <InviteLine />
    </ContentPage>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Bullets, ContentPage, Crumbs, H1, H2, InviteLine } from "@/components/site/ContentPage";
import { FaqList } from "@/components/site/FaqList";
import { JsonLd, breadcrumbLd, faqLd } from "@/components/site/JsonLd";
import { POSTS, postBySlug, wordCount } from "@/lib/blog/posts";
import { typeBySlug } from "@/lib/seo/insurance-types";
import { absoluteUrl, pageMeta } from "@/lib/site";

type Props = { params: Promise<{ slug: string }> };

export const dynamicParams = false;
export const generateStaticParams = () => POSTS.map((p) => ({ slug: p.slug }));

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const p = postBySlug((await params).slug);
  if (!p) return {};
  return {
    ...pageMeta({ title: `${p.title} · anryh labs`, description: p.description, path: `/blog/${p.slug}` }),
    openGraph: { type: "article", title: p.title, description: p.description, url: absoluteUrl(`/blog/${p.slug}`), publishedTime: p.date, modifiedTime: p.updated, siteName: "anryh labs" },
  };
}

const longDate = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }).toLowerCase();

export default async function BlogPost({ params }: Props) {
  const post = postBySlug((await params).slug);
  if (!post) notFound();
  const path = `/blog/${post.slug}`;
  const minutes = Math.max(1, Math.round(wordCount(post) / 200));
  const types = (post.types ?? []).map(typeBySlug).filter((t) => !!t);
  const more = POSTS.filter((p) => p.slug !== post.slug).slice(0, 4);

  return (
    <ContentPage>
      <JsonLd
        data={[
          {
            "@context": "https://schema.org",
            "@type": "BlogPosting",
            headline: post.title,
            description: post.description,
            datePublished: post.date,
            dateModified: post.updated,
            mainEntityOfPage: absoluteUrl(path),
            author: { "@type": "Organization", name: "anryh labs", url: absoluteUrl() },
            publisher: { "@type": "Organization", name: "anryh labs", url: absoluteUrl() },
          },
          ...(post.faqs ? [faqLd(post.faqs)] : []),
          breadcrumbLd([
            { name: "home", url: absoluteUrl() },
            { name: "blog", url: absoluteUrl("/blog") },
            { name: post.title, url: absoluteUrl(path) },
          ]),
        ]}
      />
      <Crumbs items={[{ name: "home", href: "/" }, { name: "blog", href: "/blog" }, { name: post.title }]} />
      <H1>{post.title}</H1>
      <p className="text-sm text-slate-500">
        by anryh labs · updated <time dateTime={post.updated}>{longDate(post.updated)}</time> · {minutes} min read
      </p>
      <p className="cx-answer">
        <b>the short answer:</b> {post.answer}
      </p>

      {post.body.map((b, i) =>
        "h" in b ? (
          <H2 key={i}>{b.h}</H2>
        ) : "p" in b ? (
          <p key={i}>{b.p}</p>
        ) : (
          <Bullets key={i} items={b.ul} />
        ),
      )}

      {post.faqs && (
        <>
          <H2>common questions</H2>
          <FaqList faqs={post.faqs} />
        </>
      )}

      {types.length > 0 && (
        <>
          <H2>run these ads with migz ai</H2>
          <ul className="cx-links" style={{ listStyle: "none", padding: 0 }}>
            {types.map((t) => (
              <li key={t!.slug}>
                <Link href={`/life-insurance-ads/${t!.slug}`}>{t!.name} ads</Link>
              </li>
            ))}
            <li>
              <Link href="/pricing">pricing</Link>
            </li>
          </ul>
        </>
      )}

      <H2>more from the blog</H2>
      <ul className="cx-posts">
        {more.map((p) => (
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

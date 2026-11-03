import type { MetadataRoute } from "next";
import { POSTS } from "@/lib/blog/posts";
import { INSURANCE_TYPES } from "@/lib/seo/insurance-types";
import { absoluteUrl } from "@/lib/site";

export default function sitemap(): MetadataRoute.Sitemap {
  const pages: MetadataRoute.Sitemap = [
    { url: absoluteUrl(), priority: 1 },
    { url: absoluteUrl("/pricing"), priority: 0.9 },
    { url: absoluteUrl("/life-insurance-ads"), priority: 0.8 },
    ...INSURANCE_TYPES.map((t) => ({ url: absoluteUrl(`/life-insurance-ads/${t.slug}`), priority: 0.8 })),
    { url: absoluteUrl("/blog"), priority: 0.7 },
    ...POSTS.map((p) => ({ url: absoluteUrl(`/blog/${p.slug}`), lastModified: p.updated, priority: 0.6 })),
    { url: absoluteUrl("/contact"), priority: 0.3 },
    { url: absoluteUrl("/privacy"), priority: 0.2 },
    { url: absoluteUrl("/terms"), priority: 0.2 },
  ];
  return pages;
}

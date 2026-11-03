import type { Metadata } from "next";

// The public site: its address, name and the metadata every marketing page shares (canonical, social cards).

export const SITE_URL = "https://anryhlabs.com";
export const SITE_NAME = "anryh labs";

export const absoluteUrl = (path = "/") => `${SITE_URL}${path === "/" ? "" : path}`;

/** Title, description, canonical and social-card metadata for a marketing page. */
export function pageMeta({ title, description, path }: { title: string; description: string; path: string }): Metadata {
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: { title, description, url: absoluteUrl(path), siteName: SITE_NAME, type: "website", locale: "en_US" },
    twitter: { card: "summary_large_image", title, description },
  };
}

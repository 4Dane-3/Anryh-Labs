import "server-only";
import { publicSiteUrl } from "@/lib/edit/brand-scan";
import { isBlockedHost } from "@/lib/competitors/normalize";

// Reads public web pages: competitors' landing pages and the roofer's own site. Never a Facebook, Instagram or other
// Meta page (those come through Apify only), never a private address.

export type PageRead = { url: string; title: string | null; h1: string | null; text: string; links: string[]; videos: string[]; html: string };

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

export function readable(url: string): URL | null {
  const u = publicSiteUrl(url);
  return u && !isBlockedHost(u.hostname.replace(/^www\./, "")) ? u : null;
}

const decode = (s: string) =>
  s.replace(/&amp;/g, "&").replace(/&#39;|&apos;|&#8217;/g, "'").replace(/&quot;|&#8220;|&#8221;/g, '"').replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#\d+;/g, " ");

/** The visible text of an HTML page, roughly: scripts, styles and tags out, whitespace squeezed. */
export function visibleText(html: string) {
  return decode(
    html
      .replace(/<(script|style|noscript|svg|template)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<\/(p|div|li|h[1-6]|section|br|tr)>/gi, "\n")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}

/** YouTube, Vimeo and video-file links on a page (embeds and plain links). */
export function videosIn(html: string, base: string): string[] {
  const out = new Set<string>();
  for (const m of html.matchAll(/(?:src|href|data-src)=["']([^"']+)["']/gi)) {
    const raw = m[1];
    if (!/youtube\.com\/(embed|watch|shorts)|youtu\.be\/|vimeo\.com\/|\.mp4(\?|$)|wistia|vidyard/i.test(raw)) continue;
    try {
      out.add(new URL(raw, base).toString());
    } catch {
      // not a URL
    }
  }
  return [...out].slice(0, 12);
}

export async function readPage(url: string, max = 500_000): Promise<PageRead | null> {
  const u = readable(url);
  if (!u) return null;
  try {
    const res = await fetch(u, { headers: { "User-Agent": UA, Accept: "text/html" }, redirect: "follow", signal: AbortSignal.timeout(10_000) });
    if (!res.ok || !(res.headers.get("content-type") ?? "").includes("html")) return null;
    const final = res.url || u.toString();
    if (!readable(final)) return null;
    const html = (await res.text()).slice(0, max);
    const title = decode(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "").trim() || null;
    const h1 = visibleText(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? "").trim() || null;
    const host = new URL(final).hostname;
    const links = [
      ...new Set(
        [...html.matchAll(/<a[^>]+href=["']([^"'#]+)["']/gi)]
          .map((m) => {
            try {
              return new URL(m[1], final).toString();
            } catch {
              return "";
            }
          })
          .filter((l) => l && new URL(l).hostname === host && !/\.(pdf|jpe?g|png|gif|webp|zip|xml)(\?|$)/i.test(l)),
      ),
    ];
    return { url: final, title, h1, text: visibleText(html).slice(0, 20_000), links, videos: videosIn(html, final), html };
  } catch {
    return null;
  }
}

/** Pages on a site worth reading for proof and offers: reviews, about, services, warranty, financing, gallery. */
export function pickPages(links: string[], max = 10) {
  const score = (l: string) => {
    const p = new URL(l).pathname.toLowerCase();
    if (p === "/" || p.length > 80) return -1;
    if (/review|testimonial/.test(p)) return 6;
    if (/about|why|our-story|team/.test(p)) return 5;
    if (/warrant|guarantee|certif/.test(p)) return 5;
    if (/special|offer|promo|deal|coupon/.test(p)) return 5;
    if (/roof|replace|repair|storm|hail|insurance|gutter|siding|service/.test(p)) return 4;
    if (/gallery|project|portfolio|video/.test(p)) return 3;
    if (/blog|news|career|job|privacy|terms|login|cart/.test(p)) return -1;
    return 1;
  };
  return links.map((l) => ({ l, s: score(l) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s).slice(0, max).map((x) => x.l);
}

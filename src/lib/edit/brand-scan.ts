import "server-only";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { brandCandidates, closestGoogleFont, pickBrand, readableBrand, type Brand } from "@/lib/edit/brand";

// Reading a roofer's brand from their website, checking its fonts against Google Fonts, and loading the brand and
// the facts they gave for an edit.

export type BrandRow = {
  agent_id: string;
  website: string | null;
  logo_path: string | null;
  heading_font: string | null;
  body_font: string | null;
  background: string | null;
  text_color: string | null;
  accent: string | null;
  font_note: string | null;
  deals: string[];
  certifications: string[];
  license: string | null;
  warranties: string[];
};

export async function getBrandRow(agentId: string) {
  const { data } = await supabaseAdmin.from("agent_brand").select("*").eq("agent_id", agentId).maybeSingle();
  return data as BrandRow | null;
}

/** Only public http(s) sites: no localhost, private ranges or bare IPs (the server fetches what the roofer types). */
export function publicSiteUrl(input: string): URL | null {
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(input.trim()) ? input.trim() : `https://${input.trim()}`);
  } catch {
    return null;
  }
  if (!/^https?:$/.test(url.protocol) || url.username || url.password) return null;
  const host = url.hostname.toLowerCase();
  if (!host.includes(".") || host.endsWith(".local") || host.endsWith(".internal") || host === "localhost") return null;
  if (/^[\d.]+$/.test(host) || host.includes(":")) return null; // IP literals
  return url;
}

async function fetchText(url: string, max = 600_000) {
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; AnryhLabsBrandScan/1.0)" }, redirect: "follow", signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`${res.status}`);
  const text = await res.text();
  return text.slice(0, max);
}

/** Whether a family is on Google Fonts (free to use and download). */
export async function isGoogleFont(family: string) {
  const res = await fetch(`https://fonts.googleapis.com/css2?family=${encodeURIComponent(family).replace(/%20/g, "+")}:wght@400;700`, { signal: AbortSignal.timeout(5000) }).catch(() => null);
  return !!res?.ok;
}

/** The woff2 files for a Google Font (regular and bold), for the render worker to load locally. */
export async function googleFontFiles(family: string): Promise<{ weight: number; url: string }[]> {
  // The light weight for the small lead words of a caption, when the family has one (asking for a weight it lacks fails the whole request)
  const get = (weights: string) =>
    fetch(`https://fonts.googleapis.com/css2?family=${encodeURIComponent(family).replace(/%20/g, "+")}:wght@${weights}`, {
      headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36" },
      signal: AbortSignal.timeout(5000),
    }).catch(() => null);
  let res = await get("300;400;700;800");
  if (!res?.ok) res = await get("400;700;800");
  if (!res?.ok) return [];
  const css = await res.text();
  // Only the latin subset of each weight (each block is preceded by a "/* latin */" style comment)
  const out: { weight: number; url: string }[] = [];
  for (const [, subset, block] of css.matchAll(/\/\*\s*([\w-]+)\s*\*\/\s*@font-face\s*\{([^}]*)\}/g)) {
    if (subset !== "latin") continue;
    const weight = Number(block.match(/font-weight:\s*(\d+)/)?.[1] ?? 400);
    const url = block.match(/url\((https:[^)]+\.woff2)\)/)?.[1];
    if (url && !out.some((f) => f.weight === weight)) out.push({ weight, url });
  }
  if (!out.length) {
    // A font with one subset has no subset comments
    for (const [, block] of css.matchAll(/@font-face\s*\{([^}]*)\}/g)) {
      const weight = Number(block.match(/font-weight:\s*(\d+)/)?.[1] ?? 400);
      const url = block.match(/url\((https:[^)]+\.woff2)\)/)?.[1];
      if (url && !out.some((f) => f.weight === weight)) out.push({ weight, url });
    }
  }
  return out;
}

export type ScanResult = { headingFont: string; bodyFont: string; background: string; text: string; accent: string; note: string | null; found: { headingFont: string | null; bodyFont: string | null } };

/** Their site's heading font, body font, background, text and accent, with any font swapped for a free one. */
export async function scanBrandSite(input: string): Promise<ScanResult> {
  const url = publicSiteUrl(input);
  if (!url) throw new Error("Enter your website, like yourcompany.com.");
  let html: string;
  try {
    html = await fetchText(url.toString());
  } catch {
    throw new Error("Couldn't open that website. Check the address and try again.");
  }
  const sheets = [...html.matchAll(/<link[^>]+rel=["']?stylesheet["']?[^>]*>/gi)]
    .map((m) => m[0].match(/href=["']([^"']+)["']/i)?.[1])
    .filter((h): h is string => !!h && !/fonts\.googleapis/.test(h))
    .slice(0, 5);
  const css = (
    await Promise.all(
      sheets.map(async (h) => {
        try {
          const u = new URL(h, url);
          return publicSiteUrl(u.toString()) ? await fetchText(u.toString(), 400_000) : "";
        } catch {
          return "";
        }
      }),
    )
  ).join("\n");
  const picked = pickBrand(brandCandidates(html, css));
  const notes: string[] = [];
  const free = async (f: string | null) => {
    if (!f) return "Inter";
    if (await isGoogleFont(f)) return f;
    const swap = closestGoogleFont(f);
    notes.push(`${f} isn't a free font, so videos use ${swap}, the closest free match.`);
    return swap;
  };
  const headingFont = await free(picked.headingFont);
  const bodyFont = picked.bodyFont === picked.headingFont ? headingFont : await free(picked.bodyFont);
  const b = readableBrand({ headingFont, bodyFont, background: picked.background ?? undefined, text: picked.text ?? undefined, accent: picked.accent ?? undefined });
  return { headingFont: b.headingFont, bodyFont: b.bodyFont, background: b.background, text: b.text, accent: b.accent, note: notes.join(" ") || null, found: { headingFont: picked.headingFont, bodyFont: picked.bodyFont } };
}

/** The brand for an edit (readable on video), with the logo as a signed URL. */
export async function brandForEdit(agentId: string): Promise<{ brand: Brand; row: BrandRow | null }> {
  const row = await getBrandRow(agentId);
  let logoUrl: string | null = null;
  if (row?.logo_path) logoUrl = (await supabaseAdmin.storage.from("creatives").createSignedUrl(row.logo_path, 6 * 3600)).data?.signedUrl ?? null;
  const brand = readableBrand({
    headingFont: row?.heading_font ?? undefined,
    bodyFont: row?.body_font ?? undefined,
    background: row?.background ?? undefined,
    text: row?.text_color ?? undefined,
    accent: row?.accent ?? undefined,
  });
  return { brand: { ...brand, logoUrl }, row };
}

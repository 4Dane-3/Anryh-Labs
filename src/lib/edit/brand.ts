// A roofer's brand for the edit, and reading it from their website's HTML and CSS. No I/O.

export type Brand = {
  headingFont: string; // a Google Font family (the closest free one when theirs isn't)
  bodyFont: string;
  background: string; // #rrggbb: cards, the end card
  text: string; // #rrggbb: card text, captions
  accent: string; // #rrggbb: one word or element at a time, never a background
  logoUrl?: string | null;
};

export const DEFAULT_BRAND: Brand = { headingFont: "Inter", bodyFont: "Inter", background: "#141413", text: "#FFFFFF", accent: "#F59E0B" };

export function normalizeHex(c: string | null | undefined): string | null {
  if (!c) return null;
  const s = c.trim().toLowerCase();
  let m = s.match(/^#([0-9a-f]{3})$/);
  if (m) return `#${[...m[1]].map((x) => x + x).join("")}`.toUpperCase();
  m = s.match(/^#([0-9a-f]{6})([0-9a-f]{2})?$/);
  if (m) return `#${m[1]}`.toUpperCase();
  m = s.match(/^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)(?:[\s,/]+([\d.]+%?))?\s*\)$/);
  if (m) {
    if (m[4] !== undefined && parseFloat(m[4]) < (m[4].endsWith("%") ? 50 : 0.5)) return null; // mostly transparent
    return `#${[m[1], m[2], m[3]].map((n) => Math.min(255, Number(n)).toString(16).padStart(2, "0")).join("")}`.toUpperCase();
  }
  return null;
}

function rgb(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** WCAG relative luminance, 0 (black) to 1 (white). */
export function luminance(hex: string) {
  const [r, g, b] = rgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string) {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

/** How colourful a colour is (0 grey to 1 vivid), so a brand accent beats a grey border. */
function saturation(hex: string) {
  const [r, g, b] = rgb(hex).map((v) => v / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return max === 0 ? 0 : (max - min) / max;
}

/**
 * A brand that reads on video: the card background dark enough for white-ish text (cards sit over footage), text
 * with at least 4.5:1 on it, and an accent that stands out on both the cards and the captions' white.
 */
export function readableBrand(b: Partial<Brand>): Brand {
  const out: Brand = { ...DEFAULT_BRAND, ...Object.fromEntries(Object.entries(b).filter(([, v]) => v)) } as Brand;
  for (const k of ["background", "text", "accent"] as const) out[k] = normalizeHex(out[k]) ?? DEFAULT_BRAND[k];
  // A light site background makes a pale card over footage: use their text colour as the card instead, if dark
  if (luminance(out.background) > 0.4) {
    out.background = luminance(out.text) < 0.1 ? out.text : DEFAULT_BRAND.background;
  }
  if (contrast(out.text, out.background) < 4.5) out.text = "#FFFFFF";
  if (contrast(out.accent, out.background) < 3 || saturation(out.accent) < 0.25) out.accent = DEFAULT_BRAND.accent;
  return out;
}

export type BrandCandidates = { headingFonts: string[]; bodyFonts: string[]; colors: { hex: string; count: number }[]; themeColor: string | null; backgrounds: string[]; texts: string[] };

const GENERIC = /^(inherit|initial|unset|serif|sans-serif|monospace|system-ui|-apple-system|blinkmacsystemfont|ui-sans-serif|ui-serif|ui-monospace|cursive|fantasy|emoji|segoe ui|roboto|helvetica neue|arial|helvetica|noto sans|apple color emoji|segoe ui emoji|segoe ui symbol|noto color emoji|var\(.*\))$/i;

function firstFamily(value: string) {
  for (const raw of value.split(",")) {
    const f = raw.trim().replace(/^['"]|['"]$/g, "").replace(/!important/i, "").trim();
    if (f && !GENERIC.test(f)) return f;
  }
  return null;
}

function rank(list: string[]) {
  const counts = new Map<string, number>();
  for (const x of list) counts.set(x, (counts.get(x) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([x]) => x);
}

/** What a site's own HTML and CSS say about its fonts and colours, most used first. */
export function brandCandidates(html: string, css: string): BrandCandidates {
  const all = `${css}\n${[...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]).join("\n")}\n${[...html.matchAll(/style="([^"]*)"/gi)].map((m) => `x{${m[1]}}`).join("\n")}`;
  const heading: string[] = [];
  const body: string[] = [];
  const backgrounds: string[] = [];
  const texts: string[] = [];
  // CSS custom properties, resolved one level (var(--brand) -> its value)
  const vars = new Map([...all.matchAll(/(--[\w-]+)\s*:\s*([^;}]+)/g)].map((m) => [m[1], m[2].trim()]));
  const resolve = (v: string) => v.replace(/var\((--[\w-]+)(?:,[^)]*)?\)/g, (_, n: string) => vars.get(n) ?? "");
  for (const m of all.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = m[1].toLowerCase();
    const decls = resolve(m[2]);
    const fam = decls.match(/font-family\s*:\s*([^;]+)/i);
    if (fam) {
      const f = firstFamily(fam[1]);
      if (f) (/\bh[1-3]\b|heading|title|display|hero/.test(selector) ? heading : body).push(f);
    }
    if (/(^|[\s,])(body|html|main|:root)\b/.test(selector)) {
      const bg = decls.match(/background(?:-color)?\s*:\s*([^;]+)/i)?.[1].match(/#[0-9a-f]{3,8}\b|rgba?\([^)]*\)/i)?.[0];
      const fg = decls.match(/(?:^|;|\s)color\s*:\s*([^;]+)/i)?.[1].trim();
      if (bg && normalizeHex(bg)) backgrounds.push(normalizeHex(bg)!);
      if (fg && normalizeHex(fg)) texts.push(normalizeHex(fg)!);
    }
  }
  // Google Fonts links name the families directly
  for (const m of html.matchAll(/fonts\.googleapis\.com\/css2?\?([^"'>]+)/gi)) {
    for (const f of m[1].matchAll(/family=([^&:;]+)/g)) {
      const name = decodeURIComponent(f[1].replace(/\+/g, " ")).trim();
      if (name && !body.includes(name) && !heading.includes(name)) body.push(name);
    }
  }
  const colors = new Map<string, number>();
  for (const c of resolve(all).match(/#[0-9a-f]{3,8}\b|rgba?\([^)]*\)/gi) ?? []) {
    const hex = normalizeHex(c);
    if (hex) colors.set(hex, (colors.get(hex) ?? 0) + 1);
  }
  const themeColor = normalizeHex(html.match(/<meta[^>]+name=["']theme-color["'][^>]+content=["']([^"']+)/i)?.[1] ?? html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']theme-color/i)?.[1]);
  return {
    headingFonts: rank(heading),
    bodyFonts: rank(body),
    colors: [...colors.entries()].map(([hex, count]) => ({ hex, count })).sort((a, b) => b.count - a.count),
    themeColor,
    backgrounds: rank(backgrounds),
    texts: rank(texts),
  };
}

/** The brand a site's candidates point to: fonts most used, the most-used vivid colour (or theme colour) as accent. */
export function pickBrand(c: BrandCandidates): { headingFont: string | null; bodyFont: string | null; background: string | null; text: string | null; accent: string | null } {
  const vivid = c.colors.filter((x) => saturation(x.hex) >= 0.35 && luminance(x.hex) > 0.03 && luminance(x.hex) < 0.85);
  return {
    headingFont: c.headingFonts[0] ?? c.bodyFonts[0] ?? null,
    bodyFont: c.bodyFonts[0] ?? c.headingFonts[0] ?? null,
    background: c.backgrounds[0] ?? null,
    text: c.texts[0] ?? null,
    accent: c.themeColor && saturation(c.themeColor) >= 0.35 ? c.themeColor : (vivid[0]?.hex ?? null),
  };
}

// Paid or system fonts mapped to the closest free Google Font
const CLOSEST: [RegExp, string][] = [
  [/gotham|proxima|montserrat|avenir next|brandon/i, "Montserrat"],
  [/futura|century gothic|jost/i, "Jost"],
  [/avenir|nunito/i, "Nunito Sans"],
  [/helvetica|arial|sf pro|san francisco|inter|graphik|aktiv/i, "Inter"],
  [/din|bebas|oswald|impact|league gothic|knockout|trade gothic/i, "Oswald"],
  [/gill sans|lato|museo sans/i, "Lato"],
  [/open sans|segoe/i, "Open Sans"],
  [/georgia|times|garamond|caslon|baskerville|merriweather/i, "Merriweather"],
  [/playfair|didot|bodoni/i, "Playfair Display"],
];

export function closestGoogleFont(name: string) {
  return CLOSEST.find(([re]) => re.test(name))?.[1] ?? (/serif/i.test(name) && !/sans/i.test(name) ? "Merriweather" : "Inter");
}

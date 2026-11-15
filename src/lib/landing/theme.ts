// A roofer's look on our pages (their landing pages and booking page): the colours and fonts read from their
// website. The booking calendar, call button and sticky bar are drawn in Tailwind's blue; inside a themed page those
// blues become their accent. Pure.

export type BrandLook = { heading_font?: string | null; body_font?: string | null; background?: string | null; text_color?: string | null; accent?: string | null } | null;

const HEX = /^#[0-9a-f]{6}$/i;
export const hex = (c: string | null | undefined, fallback: string) => (c && HEX.test(c) ? c : fallback);

const toHex = (rgb: number[]) => `#${rgb.map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, "0")).join("")}`;
const lum = (c: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

/** Black or white, whichever reads on the colour. */
export const onColor = (c: string) => (lum(c) > 0.45 ? "#111111" : "#ffffff");

/** Their accent, darkened just enough for white text on it to read (4.5:1), for buttons and the chosen day. */
export function readableAccent(c: string) {
  let rgb = [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
  for (let i = 0; i < 20 && 1.05 / (lum(toHex(rgb)) + 0.05) < 4.5; i++) rgb = rgb.map((v) => Math.round(v * 0.9));
  return toHex(rgb);
}

/** Tailwind's blue shades as their accent: deep shades for buttons and text, light tints for backgrounds and rings. */
export function blueAs(accent: string): Record<string, string> {
  const deep = readableAccent(accent);
  const tint = (pct: number) => `color-mix(in oklab, ${accent} ${pct}%, white)`;
  const shade = (pct: number) => `color-mix(in oklab, ${deep}, black ${pct}%)`;
  return {
    "--color-blue-50": tint(8),
    "--color-blue-100": tint(16),
    "--color-blue-200": tint(28),
    "--color-blue-300": tint(45),
    "--color-blue-400": tint(70),
    "--color-blue-500": accent,
    "--color-blue-600": deep,
    "--color-blue-700": deep,
    "--color-blue-800": shade(15),
    "--color-blue-900": shade(35),
  };
}

export const fontStack = (f: string | null | undefined) => (f ? `'${f.replace(/'/g, "")}', ui-sans-serif, system-ui, sans-serif` : "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Arial, sans-serif");

/** Everything a page needs to wear their look. Null brand: our defaults (blue, system fonts). */
export function brandTheme(brand: BrandLook) {
  const accent = hex(brand?.accent, "#1d4ed8");
  const band = hex(brand?.background, "#ffffff");
  // Our pages have a white body, so their text colour is used only when it reads on white (a dark site's light text doesn't)
  const brandInk = hex(brand?.text_color, "#0f172a");
  const ink = onColor(brandInk) === "#ffffff" ? brandInk : "#0f172a";
  const fonts = [brand?.heading_font, brand?.body_font].filter((f, i, a): f is string => !!f && a.indexOf(f) === i);
  const fontHref = fonts.length ? `https://fonts.googleapis.com/css2?${fonts.map((f) => `family=${encodeURIComponent(f).replace(/%20/g, "+")}:wght@400;600;700;800`).join("&")}&display=swap` : null;
  return {
    accent,
    ink,
    fontHref,
    vars: { ...blueAs(accent), "--lp-accent": accent, "--lp-on-accent": onColor(accent), "--lp-ink": ink, "--lp-band": band, "--lp-on-band": onColor(band) === "#ffffff" ? "#ffffff" : ink } as Record<string, string>,
    heading: fontStack(brand?.heading_font),
    body: fontStack(brand?.body_font),
  };
}

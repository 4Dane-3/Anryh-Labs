import "server-only";
import sharp from "sharp";
import { createElement as h } from "react";
import { ImageResponse } from "next/og";
import type { ImageBrief } from "@/lib/migz/brief";

// An image ad on one of the roofer's own job photos: the photo cropped to the ad's shape (sharp keeps the busiest
// part), a soft shade at the top for the lines, the last line in their accent colour, and a button shape at the
// bottom. Nothing is generated, so it costs nothing and looks like their real work.

/** A bold TrueType file of their heading font (satori can't read woff2), Inter when Google doesn't have it. */
async function boldFont(family: string | null): Promise<{ name: string; data: ArrayBuffer } | null> {
  for (const name of [family, "Inter"].filter(Boolean) as string[]) {
    try {
      const css = await (await fetch(`https://fonts.googleapis.com/css2?family=${encodeURIComponent(name)}:wght@800`)).text();
      const url = css.match(/url\((https:[^)]+\.ttf)\)/)?.[1];
      if (!url) continue;
      const res = await fetch(url);
      if (res.ok) return { name, data: await res.arrayBuffer() };
    } catch {
      // the next one
    }
  }
  return null;
}

const SIZE: Record<ImageBrief["aspect_ratio"], [number, number]> = { "4:5": [1080, 1350], "9:16": [1080, 1920], "1:1": [1080, 1080] };

export async function photoAd(photo: Buffer, brief: Pick<ImageBrief, "overlay_lines" | "button_text" | "aspect_ratio">, look: { accent?: string | null; font?: string | null } = {}): Promise<Buffer> {
  const accent = look.accent || "#F59E0B";
  const font = await boldFont(look.font ?? null);
  const [W, H] = SIZE[brief.aspect_ratio];
  const base = await sharp(photo).rotate().resize(W, H, { fit: "cover", position: sharp.strategy.attention }).modulate({ saturation: 1.05 }).toBuffer();
  const lines = brief.overlay_lines.filter(Boolean);
  const tall = brief.aspect_ratio === "9:16";
  const overlay = h(
    "div",
    { style: { width: W, height: H, display: "flex", flexDirection: "column", justifyContent: "space-between", alignItems: "center", ...(font ? { fontFamily: "Ad" } : {}) } },
    h(
      "div",
      {
        style: {
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          width: "100%",
          padding: `${tall ? 220 : 90}px 70px 160px`,
          backgroundImage: "linear-gradient(to bottom, rgba(0,0,0,0.72), rgba(0,0,0,0.45) 60%, rgba(0,0,0,0))",
        },
      },
      ...lines.map((l, i) =>
        h(
          "div",
          {
            key: i,
            style: {
              display: "flex",
              textAlign: "center",
              color: i === lines.length - 1 && lines.length > 1 ? accent : "white",
              fontSize: lines.length > 2 ? 64 : 76,
              fontWeight: 800,
              lineHeight: 1.1,
              marginTop: i ? 14 : 0,
              textShadow: "0 3px 16px rgba(0,0,0,0.6)",
            },
          },
          l,
        ),
      ),
    ),
    brief.button_text
      ? h(
          "div",
          { style: { display: "flex", width: "100%", justifyContent: "center", padding: `120px 0 ${tall ? 300 : 80}px`, backgroundImage: "linear-gradient(to top, rgba(0,0,0,0.55), rgba(0,0,0,0))" } },
          h("div", { style: { display: "flex", background: accent, color: "#111827", fontSize: 44, fontWeight: 800, padding: "22px 54px", borderRadius: 999, boxShadow: "0 10px 30px rgba(0,0,0,0.35)" } }, brief.button_text),
        )
      : h("div", { style: { display: "flex" } }),
  );
  const png = Buffer.from(await new ImageResponse(overlay, { width: W, height: H, ...(font ? { fonts: [{ name: "Ad", data: font.data, weight: 800 as const, style: "normal" as const }] } : {}) }).arrayBuffer());
  return sharp(base).composite([{ input: png }]).jpeg({ quality: 90 }).toBuffer();
}

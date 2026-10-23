import { Inter, Lato, Nunito } from "next/font/google";
import { fontKey, PAGE_FONT_INFO, type PageFontKey } from "@/lib/booking/page-font-keys";

// The fonts an agent can pick for their booking page (My page → Page font). Arial is the default: it's
// what most people read every day. Google fonts are self-hosted by next/font, and a browser only
// downloads the one the page actually uses.

const nunito = Nunito({ subsets: ["latin"], display: "swap", weight: ["400", "600", "700", "800"] });
const inter = Inter({ subsets: ["latin"], display: "swap" });
const lato = Lato({ subsets: ["latin"], display: "swap", weight: ["400", "700", "900"] });

const LOADED: Record<PageFontKey, { className: string; style: { fontFamily: string } }> = {
  arial: { className: "", style: { fontFamily: "Arial, Helvetica, sans-serif" } },
  nunito: { className: nunito.className, style: nunito.style },
  inter: { className: inter.className, style: inter.style },
  lato: { className: lato.className, style: lato.style },
  georgia: { className: "", style: { fontFamily: "Georgia, 'Times New Roman', serif" } },
  manifold: { className: "font-manifold", style: { fontFamily: "manifold-cf, ui-sans-serif, system-ui, sans-serif" } },
};

export type PageFont = (typeof PAGE_FONT_INFO)[number] & { className: string; style: { fontFamily: string } };

export const PAGE_FONTS: PageFont[] = PAGE_FONT_INFO.map((f) => ({ ...f, ...LOADED[f.key] }));

export function pageFont(key: string | null | undefined): PageFont {
  return PAGE_FONTS.find((f) => f.key === fontKey(key))!;
}

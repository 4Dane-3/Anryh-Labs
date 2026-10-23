// The booking page fonts an agent can pick, as plain data (no font loading), for the server action,
// the database check and tests. page-fonts.ts adds the loaded fonts.
export const PAGE_FONT_INFO = [
  { key: "arial", label: "Arial", note: "Familiar and easy to read" },
  { key: "nunito", label: "Nunito", note: "Rounded and friendly" },
  { key: "inter", label: "Inter", note: "Clean and modern" },
  { key: "lato", label: "Lato", note: "Warm and approachable" },
  { key: "georgia", label: "Georgia", note: "Classic and trustworthy" },
  { key: "manifold", label: "Manifold", note: "The Anryh Labs look" },
] as const;

export type PageFontKey = (typeof PAGE_FONT_INFO)[number]["key"];
export const DEFAULT_PAGE_FONT: PageFontKey = "arial";
export const PAGE_FONT_KEYS: string[] = PAGE_FONT_INFO.map((f) => f.key);

/** A saved font key, or Arial when it's missing or unknown. */
export function fontKey(key: string | null | undefined): PageFontKey {
  return (PAGE_FONT_KEYS.includes(key ?? "") ? key : DEFAULT_PAGE_FONT) as PageFontKey;
}

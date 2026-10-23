/**
 * True for the background requests a browser or Next.js makes ahead of a click (Link prefetch, speculative
 * loading). A URL that changes something must never act on one.
 */
export function isPrefetch(req: Request) {
  const h = req.headers;
  return (
    h.has("next-router-prefetch") ||
    h.get("purpose") === "prefetch" ||
    h.get("sec-purpose")?.includes("prefetch") === true ||
    h.get("x-moz") === "prefetch"
  );
}

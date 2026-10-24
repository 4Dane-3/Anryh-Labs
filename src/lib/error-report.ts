// Browser side of error reporting: sends what went wrong to /api/errors (see lib/admin/errors.ts). It never
// throws, never reports the same error twice, and stops after a few per page load, so a broken page
// can't make things worse.

type Kind = "boundary" | "window" | "rejection" | "action";

const sent = new Set<string>();
const MAX_PER_PAGE_LOAD = 5;

const messageOf = (e: unknown) => (e instanceof Error ? e.message : typeof e === "string" ? e : (() => { try { return JSON.stringify(e) ?? String(e); } catch { return String(e); } })());

export function reportClientError(kind: Kind, error: unknown, extra: { digest?: string | null } = {}) {
  try {
    if (typeof window === "undefined" || sent.size >= MAX_PER_PAGE_LOAD) return;
    const message = messageOf(error).slice(0, 400);
    const dedupe = `${kind}:${message}`;
    if (!message || sent.has(dedupe)) return;
    sent.add(dedupe);
    const body = JSON.stringify({
      kind,
      path: `${window.location.pathname}${window.location.search ? "?q" : ""}`,
      message,
      stack: error instanceof Error ? (error.stack ?? "").slice(0, 800) : null,
      digest: extra.digest ?? (error as { digest?: string } | null)?.digest ?? null,
      ua: navigator.userAgent.slice(0, 160),
    });
    if (navigator.sendBeacon?.("/api/errors", new Blob([body], { type: "application/json" }))) return;
    fetch("/api/errors", { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true }).catch(() => {});
  } catch {
    // reporting must never be the thing that breaks
  }
}

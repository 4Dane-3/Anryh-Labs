// Page analytics for agent booking pages (browser only). Events are queued and sent in small batches,
// and flushed when the page is hidden, so tracking never slows the page down. A visit is a random id
// kept for this tab session: no cookies, nothing that identifies the person. Preview mode (the agent's
// own dashboard) never tracks.

export const PAGE_EVENTS = [
  "view",
  "scroll",
  "see_calendar",
  "pick_day",
  "pick_soonest",
  "pick_time",
  "form_start",
  "form_continue",
  "submit",
  "booked",
  "booking_error",
  "sticky_click",
  "bio_expand",
  "leave",
  "call_click",
] as const;
export type PageEvent = (typeof PAGE_EVENTS)[number];

type Queued = { name: PageEvent; meta?: Record<string, string | number | boolean | null> };

let slug: string | null = null;
let session = "";
const queue: Queued[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
const once = new Set<string>();

function newId() {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

function flush(beacon = false) {
  if (!slug || !queue.length) return;
  const body = JSON.stringify({ session, events: queue.splice(0, 30) });
  const url = `/api/agents/${slug}/events`;
  try {
    if (beacon && navigator.sendBeacon?.(url, new Blob([body], { type: "application/json" }))) return;
  } catch {
    // fall through to fetch
  }
  fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true }).catch(() => {});
}

/** Starts tracking this page view. Safe to call more than once. */
export function startTracking(agentSlug: string) {
  if (slug === agentSlug) return;
  slug = agentSlug;
  try {
    const key = `pv:${agentSlug}`;
    session = sessionStorage.getItem(key) ?? newId();
    sessionStorage.setItem(key, session);
  } catch {
    session = newId();
  }
  const params = new URLSearchParams(window.location.search);
  let referrer: string | null = null;
  try {
    referrer = document.referrer ? new URL(document.referrer).hostname : null;
  } catch {
    // unreadable referrer
  }
  track("view", {
    source: params.get("utm_source") ?? (params.has("fbclid") ? "facebook" : referrer ? "referral" : "direct"),
    ad: params.get("utm_content"),
    device: window.matchMedia("(max-width: 767px)").matches ? "mobile" : "desktop",
    referrer,
  });

  const started = Date.now();
  let maxScroll = 0;
  const onScroll = () => {
    const doc = document.documentElement;
    const depth = Math.min(100, Math.round(((window.scrollY + window.innerHeight) / Math.max(1, doc.scrollHeight)) * 100));
    maxScroll = Math.max(maxScroll, depth);
    for (const mark of [25, 50, 75, 100]) if (depth >= mark) trackOnce(`scroll-${mark}`, "scroll", { depth: mark });
  };
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();
  const onHide = () => {
    if (document.visibilityState !== "hidden") return;
    track("leave", { ms: Date.now() - started, scroll: maxScroll });
    flush(true);
  };
  document.addEventListener("visibilitychange", onHide);
  window.addEventListener("pagehide", () => flush(true));
}

/** Records one step of the visit. */
export function track(name: PageEvent, meta?: Queued["meta"]) {
  if (!slug) return;
  queue.push({ name, meta });
  if (timer) clearTimeout(timer);
  // Batches quick bursts (picking a day then a time); "booked" goes out at once before the page changes,
  // and a call tap by beacon, since the phone's dialer takes over straight away
  if (name === "call_click") flush(true);
  else if (name === "booked" || name === "submit") flush();
  else timer = setTimeout(() => flush(), 1500);
}

/** Records a step only the first time it happens in this page view. */
export function trackOnce(key: string, name: PageEvent, meta?: Queued["meta"]) {
  if (once.has(key)) return;
  once.add(key);
  track(name, meta);
}

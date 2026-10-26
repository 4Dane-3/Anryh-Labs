// Errors anywhere on the site (an agent's dashboard, a booking page, the admin, the server), turned into
// one alert per distinct problem. Pure functions, so tests can check how errors are grouped, which are
// ignored and what the Slack message says. The pipeline that stores and sends them is errors.ts.

export type IssueKind = "boundary" | "window" | "rejection" | "action" | "server";
export type Area = "dashboard" | "admin" | "booking page" | "site";

export type IssueReport = {
  kind: IssueKind;
  path: string;
  message: string;
  stack?: string | null;
  digest?: string | null;
  ua?: string | null;
  method?: string | null;
  routeType?: string | null;
  agentId?: string | null;
  agentName?: string | null;
  agentSlug?: string | null;
};

export const MAX_NEW_ALERTS_PER_HOUR = 40; // beyond this, new kinds of error are counted in the log but not stored
export const REMIND_EVERY_HOURS = 6; // an error still happening pings again after this long

const RESERVED = new Set(["dashboard", "admin", "api", "login", "auth", "privacy", "terms", "contact", "companies", "our-story", "open-source-apps", "data-deletion", "join"]);
const firstSegment = (path: string) => path.split("?")[0].split("/").filter(Boolean)[0] ?? "";

export function areaOf(path: string): Area {
  const seg = firstSegment(path);
  if (seg === "dashboard") return "dashboard";
  if (seg === "admin") return "admin";
  if (!seg || RESERVED.has(seg)) return "site";
  return "booking page";
}

/** An agent's slug when the path is one of their booking pages, else null. */
export const slugOf = (path: string) => (areaOf(path) === "booking page" ? firstSegment(path) : null);

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/** The message with ids, numbers and quoted names blanked, so the same error from different people groups together. */
export function normalizeMessage(message: string) {
  return message
    .replace(UUID, "<id>")
    .replace(/"[^"]{1,80}"/g, '"<x>"')
    .replace(/\b[0-9a-f]{10,}\b/gi, "<h>")
    .replace(/\d+/g, "<n>")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
}

export const normalizePath = (path: string) => path.split("?")[0].replace(UUID, ":id").replace(/\/\d+(?=\/|$)/g, "/:id");

function hash(text: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/** One key per distinct problem: where it happened and what it said. */
export const issueKey = (r: Pick<IssueReport, "kind" | "path" | "message">) =>
  `site_error:${areaOf(r.path)}:${hash(`${r.kind === "server" ? "server" : "browser"}|${normalizePath(r.path)}|${normalizeMessage(r.message)}`)}`;

// Noise that isn't a problem with the site: browser quirks, extensions, a stale tab's missing script
// (the "Migz was just updated" notice covers that), navigation redirects, and an Android in-app browser
// (Facebook, Instagram) whose own bridge script fails after the visitor closes it
const IGNORED = [
  /ResizeObserver loop/i,
  /^script error\.?$/i,
  /(chrome|moz|safari)-extension:/i,
  /non-error promise rejection/i,
  /AbortError|aborted/i,
  /loading (css )?chunk [\w-]+ failed|ChunkLoadError|Failed to load chunk/i,
  /NEXT_REDIRECT|NEXT_NOT_FOUND|NEXT_HTTP_ERROR_FALLBACK/,
  /Java object is gone/i,
];
// A dropped connection in the browser isn't a bug (a failed save still reports as "action")
const NETWORK = /^(failed to fetch|load failed|networkerror|network request failed)/i;

export function shouldIgnore(r: IssueReport) {
  const message = r.message.trim();
  if (!message) return true;
  if (r.path.startsWith("/api/errors") || r.path.startsWith("/_next")) return true;
  if (IGNORED.some((re) => re.test(message) || re.test(r.stack ?? ""))) return true;
  if ((r.kind === "window" || r.kind === "rejection") && NETWORK.test(message)) return true;
  return false;
}

/** A crash or a server error is critical; a failed save or a stray browser error is a warning. */
export const severityOf = (r: IssueReport): "critical" | "warn" => (r.kind === "boundary" || r.kind === "server" ? "critical" : "warn");

const KIND_LABEL: Record<IssueKind, string> = {
  boundary: "The page crashed",
  window: "A browser error",
  rejection: "A browser error",
  action: "A save or button failed",
  server: "A server error",
};
export const kindLabel = (k: IssueKind) => KIND_LABEL[k];

export function titleOf(r: IssueReport) {
  const who = r.agentName ?? r.agentSlug;
  switch (areaOf(r.path)) {
    case "dashboard":
      return `Error in ${who ? `${who}'s` : "an agent's"} dashboard`;
    case "admin":
      return "Error in the admin dashboard";
    case "booking page":
      return `Error on ${who ? `${who}'s` : "a"} booking page`;
    default:
      return "Error on the site";
  }
}

export const detailOf = (r: IssueReport) =>
  `${kindLabel(r.kind)} at ${r.path.split("?")[0]}: ${r.message.replace(/\s+/g, " ").trim().slice(0, 300)}${r.digest ? ` (digest ${r.digest})` : ""}`.slice(0, 600);

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** The Slack message for staff. `reminder` marks an error that was already reported and is still happening. */
export function issueSlackMessage(r: IssueReport, opts: { appUrl: string; reminder?: boolean }) {
  const area = areaOf(r.path);
  const path = r.path.split("?")[0];
  const where = `${esc(path)}${r.method && r.kind === "server" ? ` (${esc(r.method)})` : ""}`;
  const who = r.agentName ? `${esc(r.agentName)}${r.agentSlug ? ` (/${esc(r.agentSlug)})` : ""}` : area === "booking page" ? "a visitor" : "not signed in";
  const title = `${opts.reminder ? "Still happening: " : ""}${titleOf(r)}`;
  const buttons: unknown[] = [{ type: "button", text: { type: "plain_text", text: "Open the admin dashboard" }, url: `${opts.appUrl}/admin`, style: "primary" }];
  if (r.agentSlug && area === "dashboard")
    buttons.push({ type: "button", text: { type: "plain_text", text: "See their page" }, url: `${opts.appUrl}/admin/view/${encodeURIComponent(r.agentSlug)}?to=${encodeURIComponent(path)}` });
  return {
    text: `${title}: ${cut(r.message, 160)}`,
    blocks: [
      { type: "header", text: { type: "plain_text", text: cut(`:rotating_light: ${title}`, 150), emoji: true } },
      { type: "section", text: { type: "mrkdwn", text: `*${esc(kindLabel(r.kind))}*\n>${esc(cut(r.message.replace(/\s+/g, " ").trim(), 500))}` } },
      { type: "section", fields: [{ type: "mrkdwn", text: `*Where*\n${where}` }, { type: "mrkdwn", text: `*Who*\n${who}` }] },
      ...(r.ua || r.digest || r.routeType
        ? [{ type: "context", elements: [{ type: "mrkdwn", text: esc(cut([r.routeType ? `${r.routeType}` : "", r.digest ? `digest ${r.digest}` : "", r.ua ?? ""].filter(Boolean).join(" · "), 300)) }] }]
        : []),
      { type: "actions", elements: buttons },
    ],
  };
}

import type { Agent } from "@/lib/booking/data";

// The weekly special check's rules: when it's due, which ads promote a special, and the email. Pure, for the tests.

export const SPECIAL_EVERY_DAYS = 7;
const DAY = 86_400_000;
const appUrl = () => (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Due when it hasn't been asked or confirmed in the last week. Pure, for the tests. */
export function specialCheckDue(row: { deals: string[]; special_asked_at: string | null; special_confirmed_at: string | null }, now = Date.now()) {
  if (!row.deals.filter(Boolean).length) return false;
  const recent = (t: string | null) => !!t && now - Date.parse(t) < SPECIAL_EVERY_DAYS * DAY;
  return !recent(row.special_asked_at) && !recent(row.special_confirmed_at);
}

/** Words that pick out ads promoting a special: its dollar or percent amounts, else its longest words. Pure. */
export function specialMarkers(special: string) {
  const amounts = special.match(/\$\s?[\d,]+|\d+\s?%/g)?.map((a) => a.replace(/\s/g, "").toLowerCase()) ?? [];
  if (amounts.length) return amounts;
  return special
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 6)
    .sort((a, b) => b.length - a.length)
    .slice(0, 2);
}

export const promotes = (text: string, markers: string[]) => {
  const t = text.toLowerCase().replace(/\$\s+/g, "$");
  return markers.length > 0 && markers.every((m) => t.includes(m));
};

export function specialEmail(agent: Pick<Agent, "full_name">, special: string) {
  const url = `${appUrl()}/dashboard/special`;
  const subject = `Is "${special}" still running?`;
  const text = `Hi ${agent.full_name},\n\nYour ads are featuring this special: ${special}\n\nIs it still running? Confirm it, or tell Migz it's ended and give the new one. If it's ended, Migz pauses the ads promoting it and makes new ones.\n\n${url}\n\nMigz AI`;
  const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;font-size:15px;color:#141413;line-height:1.5">
<p>Hi ${esc(agent.full_name)},</p>
<p>Your ads are featuring this special:</p>
<p style="font-size:18px;font-weight:700">${esc(special)}</p>
<p>Is it still running?</p>
<p><a href="${url}?answer=yes" style="display:inline-block;background:#141413;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none;font-weight:600">Yes, still running</a>
&nbsp; <a href="${url}?answer=ended" style="display:inline-block;border:1px solid #141413;color:#141413;padding:9px 16px;border-radius:8px;text-decoration:none;font-weight:600">It's ended</a></p>
<p style="color:#555">If it's ended, Migz pauses the ads promoting it and makes new ones with your new special.</p>
<p>Migz AI</p></div>`;
  return { subject, text, html };
}


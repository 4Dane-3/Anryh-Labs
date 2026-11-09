import "server-only";
import { DateTime } from "luxon";
import { supabaseAdmin } from "@/lib/supabase-admin";
import type { Agent } from "@/lib/booking/data";
import { ROOFING_ADDRESS_KEY, ROOFING_HOMEOWNER_KEY, type IntakeAnswers } from "@/lib/booking/questions";
import { displayPhone, streetOf } from "@/lib/roofing/print";
import { isRoofer } from "@/lib/verticals";
import { describeRules, fitLabel, hasRules, type FitResult, type JobRules } from "@/lib/roofing/job-rules";

// What a roofer hears about their bookings: an email the moment an inspection is booked (the homeowner, the
// address, what's wrong, and that street's postcard and door hanger to print), a morning-of email listing the
// day's inspections, and, if they set one up, each booking POSTed to their CRM (Zapier, Make, or a CRM's own
// webhook). The sales cycle after the inspection is theirs; nothing here pulls from their CRM.

const appUrl = () => (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

export type InspectionBooking = { id: string; starts_at: string; ends_at: string; name: string; email: string; phone: string; crew?: number | null };

const answer = (answers: IntakeAnswers | null | undefined, key: string) => answers?.[key]?.value?.trim() || null;
export const printUrl = (bookingId: string) => `${appUrl()}/print/${bookingId}`;
const mapsUrl = (address: string) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;

/** Sends through Resend (pass `from` / `reply_to` in the body to override). No-op until Resend is set up. */
export async function resend(body: Record<string, unknown>, idempotencyKey: string) {
  if (!process.env.RESEND_API_KEY || !process.env.BOOKING_EMAIL_FROM) return { skipped: true as const };
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Idempotency-Key": idempotencyKey },
    body: JSON.stringify({ from: `Migz AI <${process.env.BOOKING_EMAIL_FROM}>`, ...body }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return { skipped: false as const };
}

/** The new-inspection email to the roofer (pure, for the tests). */
export type FitInfo = { fit: Pick<FitResult, "verdict" | "reasons" | "flags" | "urgent">; rules: JobRules | null };

export function inspectionEmail(agent: Pick<Agent, "full_name" | "timezone">, booking: InspectionBooking, answers: IntakeAnswers | null, fitInfo?: FitInfo) {
  const start = DateTime.fromISO(booking.starts_at).setZone(agent.timezone);
  const when = `${start.toFormat("cccc, LLL d")} at ${start.toFormat("h:mm a")}`;
  const address = answer(answers, ROOFING_ADDRESS_KEY);
  const owner = answer(answers, ROOFING_HOMEOWNER_KEY);
  const street = streetOf(address);
  const rows: [string, string][] = [
    ["When", when + (booking.crew && booking.crew > 1 ? ` (crew ${booking.crew})` : "")],
    ["Address", address ?? "Not given"],
    ["Homeowner", booking.name],
    ["Phone", displayPhone(booking.phone)],
    ["Email", booking.email],
    ["Owns the home", owner ?? "Not answered"],
    ["The roof", [answer(answers, "roof_issue"), answer(answers, "roof_age") && `${answer(answers, "roof_age")} old`].filter(Boolean).join(" · ") || "Not answered"],
  ];
  // How they fit the roofer's "Jobs we take" rules, and the rules themselves (only when the roofer has set some)
  if (fitInfo && (hasRules(fitInfo.rules) || fitInfo.fit.urgent)) {
    const { fit, rules } = fitInfo;
    if (fit.urgent) rows.push(["Active leak", "Water is coming in and you take same-day leak calls. Call them first."]);
    const detail = fit.verdict === "fit" ? fitLabel("fit") : `${fitLabel(fit.verdict)}: ${[...fit.reasons, ...fit.flags].join("; ")}`;
    if (hasRules(rules)) rows.push(["Your job rules", detail ?? ""], ["Rules set", describeRules(rules).join(" · ")]);
    else if (fit.flags.length) rows.push(["Check", fit.flags.join(" · ")]);
  }
  const subject = `New inspection: ${street ?? booking.name}, ${start.toFormat("ccc LLL d, h:mm a")}`;
  const print = printUrl(booking.id);
  const html = `<!doctype html><html><body style="margin:0;background:#f8fafc;padding:24px 12px;font-family:${FONT};color:#0f172a;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:16px;">
<tr><td style="padding:26px 26px 6px;"><h1 style="margin:0;font:700 24px/1.25 ${FONT};">New free inspection booked</h1>
<p style="margin:8px 0 0;font:400 15px/1.5 ${FONT};color:#334155;">From your Migz ads, for ${esc(agent.full_name)}.</p></td></tr>
<tr><td style="padding:16px 26px 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:12px;">
${rows.map(([k, v], i) => `<tr><td style="padding:10px 14px;${i ? "border-top:1px solid #e2e8f0;" : ""}font:600 12px/1.3 ${FONT};color:#64748b;text-transform:uppercase;letter-spacing:.05em;width:120px;vertical-align:top;">${esc(k)}</td><td style="padding:10px 14px;${i ? "border-top:1px solid #e2e8f0;" : ""}font:400 15px/1.4 ${FONT};">${esc(v)}</td></tr>`).join("")}
</table></td></tr>
<tr><td style="padding:20px 26px 0;">
<a href="${esc(print)}" style="display:inline-block;padding:13px 20px;border-radius:999px;background:#0f172a;color:#fff;font:600 15px/1 ${FONT};text-decoration:none;">Print ${esc(street ? `${street}'s` : "the")} postcard &amp; door hanger</a>
${address ? `&nbsp; <a href="${esc(mapsUrl(address))}" style="font:500 14px/1 ${FONT};color:#0f172a;">Open in Maps</a>` : ""}
<p style="margin:12px 0 0;font:400 13px/1.55 ${FONT};color:#64748b;">Mail the postcard to the street, or leave door hangers on nearby doors while you're there. Neither names your customer. Their QR code books on your page.</p>
</td></tr>
<tr><td style="padding:20px 26px 24px;"><p style="margin:0;border-top:1px solid #e2e8f0;padding-top:14px;font:400 12px/1.6 ${FONT};color:#94a3b8;">You'll get a reminder the morning of. If they turn out not to own the home, or don't show, mark it in your dashboard so Migz learns which ads bring real homeowners.</p></td></tr>
</table></body></html>`;
  const text = [`New free inspection booked`, ``, ...rows.map(([k, v]) => `${k}: ${v}`), ``, `Print the postcard & door hanger: ${print}`].join("\n");
  return { subject, html, text };
}

/** Emails the roofer about a new inspection. No-op until Resend is set up. */
export async function sendInspectionBooked(agent: Agent, booking: InspectionBooking, answers: IntakeAnswers | null, fitInfo?: FitInfo) {
  if (!isRoofer(agent)) return { skipped: true as const };
  const email = inspectionEmail(agent, booking, answers, fitInfo);
  return resend({ to: [agent.business_email || agent.email], subject: email.subject, html: email.html, text: email.text }, `inspection-booked/${booking.id}`);
}

// ---------- CRM webhook ----------

/** What a roofer's CRM receives for each booking (pure): flat fields, so Zapier maps them without code. */
export function crmPayload(agent: Pick<Agent, "slug" | "full_name" | "timezone">, booking: InspectionBooking, answers: IntakeAnswers | null) {
  const start = DateTime.fromISO(booking.starts_at).setZone(agent.timezone);
  const [first, ...rest] = booking.name.trim().split(/\s+/);
  return {
    event: "inspection.booked",
    booking_id: booking.id,
    company: agent.full_name,
    starts_at: booking.starts_at,
    ends_at: booking.ends_at,
    starts_at_local: start.toFormat("yyyy-LL-dd HH:mm"),
    timezone: agent.timezone,
    name: booking.name,
    first_name: first ?? "",
    last_name: rest.join(" "),
    phone: booking.phone,
    email: booking.email,
    address: answer(answers, ROOFING_ADDRESS_KEY),
    homeowner: answer(answers, ROOFING_HOMEOWNER_KEY),
    roof_issue: answer(answers, "roof_issue"),
    roof_age: answer(answers, "roof_age"),
    source: "Migz AI (Meta ads)",
    print_url: printUrl(booking.id),
  };
}

/** A webhook URL we'll send to: https only, no private hosts. */
export function validWebhookUrl(raw: string) {
  try {
    const u = new URL(raw.trim());
    if (u.protocol !== "https:") return false;
    return !/^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.|\[)/i.test(u.hostname) && u.hostname.includes(".");
  } catch {
    return false;
  }
}

/** POSTs a booking to the roofer's CRM webhook and records how it went. */
export async function sendToCrm(agent: Agent, booking: InspectionBooking, answers: IntakeAnswers | null) {
  if (!isRoofer(agent) || !agent.crm_webhook_url || !validWebhookUrl(agent.crm_webhook_url)) return { skipped: true as const };
  let error: string | null = null;
  try {
    const res = await fetch(agent.crm_webhook_url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": "MigzAI-Webhook/1" },
      body: JSON.stringify(crmPayload(agent, booking, answers)),
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) error = `HTTP ${res.status}`;
  } catch (e) {
    error = e instanceof Error ? e.message.slice(0, 200) : "failed";
  }
  await supabaseAdmin.from("bookings").update(error ? { crm_error: error } : { crm_sent_at: new Date().toISOString(), crm_error: null }).eq("id", booking.id);
  return { skipped: false as const, error };
}

// ---------- The morning-of reminder ----------

/** Local hour the day's inspection list goes out. */
const REMIND_HOUR = 7;

/** The morning-of email (pure). */
export function morningEmail(agent: Pick<Agent, "full_name" | "timezone">, items: { booking: InspectionBooking; address: string | null }[]) {
  const day = DateTime.now().setZone(agent.timezone).toFormat("cccc, LLL d");
  const lines = items.map(({ booking, address }) => ({
    time: DateTime.fromISO(booking.starts_at).setZone(agent.timezone).toFormat("h:mm a"),
    who: booking.name,
    phone: displayPhone(booking.phone),
    address: address ?? "No address given",
    print: printUrl(booking.id),
  }));
  const subject = `${lines.length} inspection${lines.length === 1 ? "" : "s"} today · ${day}`;
  const html = `<!doctype html><html><body style="margin:0;background:#f8fafc;padding:24px 12px;font-family:${FONT};color:#0f172a;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:16px;">
<tr><td style="padding:26px 26px 8px;"><h1 style="margin:0;font:700 22px/1.25 ${FONT};">Today's inspections</h1><p style="margin:6px 0 0;font:400 14px/1.5 ${FONT};color:#64748b;">${esc(day)} · ${esc(agent.full_name)}</p></td></tr>
${lines.map((l) => `<tr><td style="padding:12px 26px;border-top:1px solid #e2e8f0;"><div style="font:600 16px/1.35 ${FONT};">${esc(l.time)} · ${esc(l.address)}</div><div style="font:400 14px/1.5 ${FONT};color:#334155;">${esc(l.who)} · ${esc(l.phone)}</div><a href="${esc(l.print)}" style="font:500 13px/1.6 ${FONT};color:#0f172a;">Postcard &amp; door hanger for this street</a></td></tr>`).join("")}
<tr><td style="padding:16px 26px 24px;border-top:1px solid #e2e8f0;"><p style="margin:0;font:400 12px/1.6 ${FONT};color:#94a3b8;">Bring a stack of door hangers for each street. Mark no-shows or renters in your dashboard afterwards.</p></td></tr>
</table></body></html>`;
  const text = [subject, "", ...lines.map((l) => `${l.time} · ${l.address} · ${l.who} ${l.phone}\n  Print: ${l.print}`)].join("\n");
  return { subject, html, text };
}

/** Sends each roofer the day's inspections once, at 7am their time or later in the morning. Returns slug -> count. */
export async function sendInspectionReminders(deadlineMs: number) {
  const out: Record<string, number> = {};
  const { data: agents, error } = await supabaseAdmin.from("agents").select("*").eq("active", true).eq("vertical", "roofing");
  if (error) return out; // before the roofing migration
  for (const agent of (agents ?? []) as Agent[]) {
    if (Date.now() > deadlineMs) break;
    const local = DateTime.now().setZone(agent.timezone);
    if (local.hour < REMIND_HOUR || local.hour >= 12) continue;
    const { data: today } = await supabaseAdmin
      .from("bookings")
      .select("id, starts_at, ends_at, name, email, phone, crew")
      .eq("agent_id", agent.id)
      .eq("status", "confirmed")
      .is("roofer_reminded_at", null)
      .gte("starts_at", DateTime.now().toUTC().toISO()!)
      .lte("starts_at", local.endOf("day").toUTC().toISO()!)
      .order("starts_at");
    if (!today?.length) continue;
    // Claim them first so an overlapping run can't send the list twice
    const { data: claimed } = await supabaseAdmin
      .from("bookings")
      .update({ roofer_reminded_at: new Date().toISOString() })
      .in("id", today.map((b) => b.id))
      .is("roofer_reminded_at", null)
      .select("id");
    const ids = new Set((claimed ?? []).map((c) => c.id));
    const mine = today.filter((b) => ids.has(b.id));
    if (!mine.length) continue;
    const { data: answers } = await supabaseAdmin.from("intake_responses").select("booking_id, answers").in("booking_id", mine.map((b) => b.id));
    const addr = new Map((answers ?? []).map((a) => [a.booking_id, answer(a.answers as IntakeAnswers, ROOFING_ADDRESS_KEY)]));
    const email = morningEmail(agent, mine.map((b) => ({ booking: b, address: addr.get(b.id) ?? null })));
    try {
      await resend({ to: [agent.business_email || agent.email], subject: email.subject, html: email.html, text: email.text }, `inspection-day/${local.toISODate()}/${mine[0].id}`);
      out[agent.slug] = mine.length;
    } catch (e) {
      // Give the claim back so the next hourly run tries again
      await supabaseAdmin.from("bookings").update({ roofer_reminded_at: null }).in("id", mine.map((b) => b.id));
      console.error("inspection reminder failed", agent.slug, e instanceof Error ? e.message : e);
    }
  }
  return out;
}

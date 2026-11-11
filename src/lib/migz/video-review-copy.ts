// Video approvals, the parts with no database: when to ask, and what the email and Slack message say.

export const WAIT_FOR_BATCH_MS = 60 * 60_000; // hold the first video up to an hour so a batch arrives as one message
export const NUDGE_AFTER_MS = 48 * 3_600_000;

export type WaitingVideo = { approval_ready_at: string | null; approval_requested_at: string | null; approval_nudged_at: string | null };

/**
 * Ask once per batch: when nothing else is still being made, or the oldest video has waited an hour.
 * Videos that arrive after the first ask get their own message, by the same rule.
 */
export function shouldAsk(videos: WaitingVideo[], stillMaking: boolean, now: number) {
  const unasked = videos.filter((v) => !v.approval_requested_at);
  if (!unasked.length) return false;
  if (!stillMaking) return true;
  const oldest = Math.min(...unasked.map((v) => (v.approval_ready_at ? Date.parse(v.approval_ready_at) : now)));
  return now - oldest >= WAIT_FOR_BATCH_MS;
}

/** One reminder, two days after asking, for videos still waiting. */
export function shouldNudge(videos: WaitingVideo[], now: number) {
  return videos.some((v) => v.approval_requested_at && !v.approval_nudged_at && now - Date.parse(v.approval_requested_at) >= NUDGE_AFTER_MS);
}

const firstName = (name: string) => name.trim().split(/\s+/)[0] || "there";
const htmlEscape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const videos = (n: number) => (n === 1 ? "A new video is" : `${n} new videos are`);
const them = (n: number) => (n === 1 ? "it" : "them");

export function reviewLine(count: number, nudge: boolean) {
  return nudge
    ? `${count === 1 ? "A video is" : `${count} videos are`} still waiting for your OK. Nothing goes live until you've seen ${them(count)}.`
    : `${videos(count)} ready for your ads. Take a look, then approve ${them(count)} or tell me what to change. Nothing goes live until you do.`;
}

export function reviewEmail(input: { name: string; count: number; url: string; nudge: boolean }) {
  const { name, count, url, nudge } = input;
  const subject = nudge ? `Still waiting on your OK: ${count === 1 ? "1 video" : `${count} videos`}` : `${count === 1 ? "Your new video is" : `Your ${count} new videos are`} ready to review`;
  const line = reviewLine(count, nudge);
  const signoff = "Migz AI, your AI ad manager";
  const text = `Hi ${firstName(name)},\n\n${line}\n\nWatch ${them(count)} here: ${url}\n\n${signoff}`;
  const html = `<div style="font-family:-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#0f172a;font-size:16px;line-height:1.55"><p>Hi ${htmlEscape(firstName(name))},</p><p>${htmlEscape(line)}</p><p style="margin:28px 0"><a href="${htmlEscape(url)}" style="display:inline-block;background:#0f172a;color:#ffffff;text-decoration:none;font-weight:600;padding:14px 24px;border-radius:999px">Watch and approve</a></p><p style="color:#64748b;font-size:14px">${signoff}</p></div>`;
  return { subject, text, html };
}

export function reviewSlack(input: { count: number; url: string; nudge: boolean }) {
  const text = reviewLine(input.count, input.nudge);
  return {
    text,
    blocks: [
      { type: "section", text: { type: "mrkdwn", text } },
      { type: "actions", elements: [{ type: "button", style: "primary", text: { type: "plain_text", text: "Watch and approve" }, url: input.url }] },
    ],
  };
}

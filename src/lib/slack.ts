import "server-only";

// Needs a Slack app bot token with chat:write and im:write. Passing a user id (U...) as `channel` opens a DM.
// With `blocks` (Block Kit) Slack shows the rich layout and uses `text` for the notification and as a fallback.
export async function sendSlackMessage(channel: string, text: string, blocks?: unknown[]) {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) throw new Error("SLACK_BOT_TOKEN is not set");

  const res = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ channel, text, mrkdwn: true, unfurl_links: false, ...(blocks?.length ? { blocks } : {}) }),
  });

  const data = (await res.json()) as { ok: boolean; error?: string };
  if (!data.ok) throw new Error(`Slack error: ${data.error ?? res.status}`);
}

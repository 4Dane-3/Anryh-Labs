// The Slack messages agents get from Migz, as Block Kit. Pure (no I/O) so tests can check them.
// Every message has a plain `text` too: Slack shows it in notifications and wherever blocks can't render.

export type SlackMessage = { text: string; blocks: unknown[] };

// Prospect- or model-written text goes into mrkdwn, so neutralise mentions, links and formatting tokens
export const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const usd = (cents: number) => `$${(cents / 100).toFixed(cents % 100 ? 2 : 0)}`;
const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

const header = (text: string) => ({ type: "header", text: { type: "plain_text", text: cut(text, 150), emoji: true } });
const section = (text: string) => ({ type: "section", text: { type: "mrkdwn", text: cut(text, 2900) } });
const context = (text: string) => ({ type: "context", elements: [{ type: "mrkdwn", text: cut(text, 2900) }] });
const button = (text: string, url: string, primary = false) => ({
  type: "button",
  text: { type: "plain_text", text, emoji: true },
  url,
  ...(primary ? { style: "primary" } : {}),
});
const actions = (...buttons: ReturnType<typeof button>[]) => ({ type: "actions", elements: buttons });
const divider = { type: "divider" };

export type AdPreview = {
  pageName: string; // the Facebook Page the ad runs under
  primaryText: string;
  headline: string;
  images: { url: string; alt: string }[]; // 1 for images and videos (thumbnail), 2 for carousels
  bookingUrl: string; // where "Book now" goes
  format: "image" | "video" | "carousel";
};

/** A snippet of how the ad looks in the feed: Page, copy, picture(s), headline and the Book now button. */
export function adPreviewBlocks(ad: AdPreview): unknown[] {
  const host = ad.bookingUrl.replace(/^https?:\/\//, "").split("/")[0];
  return [
    context(`*${esc(ad.pageName)}* · Sponsored`),
    section(esc(ad.primaryText)),
    ...ad.images.slice(0, 2).map((img, i) => ({
      type: "image",
      image_url: img.url,
      alt_text: cut(img.alt || "Ad image", 1900),
      ...(ad.images.length > 1 ? { title: { type: "plain_text", text: `Card ${i + 1} of ${ad.images.length}` } } : {}),
    })),
    {
      type: "section",
      text: { type: "mrkdwn", text: `${ad.format === "video" ? ":arrow_forward: Video ad\n" : ""}*${esc(cut(ad.headline, 80))}*\n${esc(host)}` },
      accessory: button("Book now", ad.bookingUrl),
    },
  ];
}

/** An ad went live in Meta (or was built paused while test mode is on). */
export function adLiveMessage(input: {
  ad: AdPreview;
  campaign: string;
  states: string[];
  held: boolean;
  dashboardUrl: string;
}): SlackMessage {
  const title = input.held ? "Your new ad is built (paused for testing)" : "Your new ad is with Meta for review";
  const kind = input.ad.format === "carousel" ? "carousel" : input.ad.format;
  return {
    text: `${title}: ${input.ad.headline}`,
    blocks: [
      header(input.held ? ":hammer_and_wrench: Your new ad is built" : ":outbox_tray: Your new ad is with Meta for review"),
      section(
        input.held
          ? `Migz built a new ${kind} ad in the *${esc(input.campaign)}* campaign. Test mode keeps it paused; it switches on when test mode ends.`
          : `Migz sent a new ${kind} ad in your *${esc(input.campaign)}* campaign to Meta. Meta reviews new ads first, usually within a few hours. You'll get a message here as soon as it's approved and showing to adults in ${esc(input.states.join(", "))}.`,
      ),
      divider,
      ...adPreviewBlocks(input.ad),
      divider,
      actions(button("Open the Migz brain", `${input.dashboardUrl}/dashboard/brain`)),
    ],
  };
}

/** Meta finished reviewing new ads: approved ones are now showing; rejected ones say why. */
export function adsReviewedMessage(input: {
  approved: { ad: AdPreview; campaign: string }[];
  rejected: { ad: AdPreview; campaign: string; reason: string | null }[];
  states: string[];
  dashboardUrl: string;
}): SlackMessage {
  const { approved, rejected } = input;
  const n = (k: number) => `${k} ad${k === 1 ? "" : "s"}`;
  const title = approved.length
    ? `Meta approved ${approved.length === 1 ? "your new ad" : `${n(approved.length)}`}${rejected.length ? `, and didn't approve ${n(rejected.length)}` : ""}`
    : `Meta didn't approve ${rejected.length === 1 ? "your new ad" : n(rejected.length)}`;
  const blocks: unknown[] = [header(`${approved.length ? ":white_check_mark:" : ":warning:"} ${title}`)];
  if (approved.length) {
    blocks.push(section(`${approved.length === 1 ? "It's" : "They're"} now showing to adults in ${esc(input.states.join(", "))}. Migz watches the results and adjusts at its reviews.`));
    if (approved.length === 1) blocks.push(divider, ...adPreviewBlocks(approved[0].ad));
    else blocks.push(section(approved.map((a) => `• *${esc(cut(a.ad.headline, 80))}* (${a.ad.format}, ${esc(a.campaign)})`).join("\n")));
  }
  for (const r of rejected) {
    blocks.push(divider, section(`:no_entry: *${esc(cut(r.ad.headline, 80))}* (${r.ad.format}, ${esc(r.campaign)}) wasn't approved.${r.reason ? ` Meta said: _${esc(cut(r.reason, 400))}_` : ""} Migz sees this at its next review and won't spend on it.`));
  }
  blocks.push(divider, actions(button("Open the Migz brain", `${input.dashboardUrl}/dashboard/brain`)));
  return { text: title, blocks };
}

/** The research shift found something worth making: what it learned and the creative idea it drafted. */
export function researchIdeaMessage(input: {
  topic: string;
  angle: string;
  finding: string;
  history: string | null;
  idea: { format: string; hook_line: string; concept: string; why: string };
  sources: { title: string; url: string }[];
  dashboardUrl: string;
}): SlackMessage {
  const title = `Migz has an idea for your next ${input.topic.toLowerCase()} ad`;
  const sources = input.sources.slice(0, 3).map((s) => `<${s.url}|${esc(cut(s.title, 60))}>`).join(" · ");
  return {
    text: `${title}: "${input.idea.hook_line}"`,
    blocks: [
      header(`:bulb: ${title}`),
      section(`*What Migz studied:* ${esc(input.angle)}\n${esc(cut(input.finding, 700))}`),
      ...(input.history ? [context(`:books: ${esc(cut(input.history, 400))}`)] : []),
      divider,
      section(`*Idea (${esc(input.idea.format)}):* "${esc(cut(input.idea.hook_line, 120))}"\n${esc(cut(input.idea.concept, 400))}\n_${esc(cut(input.idea.why, 300))}_`),
      context(`Migz uses ideas like this when it makes your next creatives at a review.${sources ? ` Sources: ${sources}` : ""}`),
      actions(button("Open the Migz brain", `${input.dashboardUrl}/dashboard/brain`)),
    ],
  };
}

/** A creative Migz made for the library (not launched yet). */
export function creativeReadyMessage(input: { ad: AdPreview; dashboardUrl: string }): SlackMessage {
  return {
    text: `New creative ready: ${input.ad.headline}`,
    blocks: [
      header(":art: A new creative is ready"),
      section("Migz made this for your creative library. It isn't running yet; Migz will put it into a campaign when it fits."),
      divider,
      ...adPreviewBlocks(input.ad),
      divider,
      actions(button("See your creatives", `${input.dashboardUrl}/dashboard/creatives`)),
    ],
  };
}

/** A batch's campaigns were set up (or the planned campaigns built) in Meta. */
export function batchSetupMessage(input: {
  budgetCents: number | null; // null when there's no batch (campaigns built from the daily budget)
  days: number | null;
  campaigns: string[];
  perCampaignCents: number;
  states: string[];
  endsOn: string | null;
  auto: boolean;
  dashboardUrl: string;
}): SlackMessage {
  const n = input.campaigns.length;
  const lead = input.budgetCents
    ? `Your ${usd(input.budgetCents)} campaign batch is set up`
    : `Migz set up ${n === 1 ? "your campaign" : `${n} campaigns`}`;
  return {
    text: `${lead}: ${input.campaigns.join(", ")}`,
    blocks: [
      header(`:rocket: ${lead}`),
      section(
        [
          `*${n} campaign${n === 1 ? "" : "s"}:* ${esc(input.campaigns.join(", "))}`,
          `*Budget:* ${usd(input.perCampaignCents)}/day each${input.days ? ` for ${input.days} days` : ""}${input.endsOn ? ` (ends ${input.endsOn})` : ""}`,
          `*Who sees it:* adults in ${esc(input.states.join(", "))}`,
        ].join("\n"),
      ),
      context(
        input.auto
          ? "Migz is running it automatically: it makes the creatives, launches the ads and tells you here as it goes."
          : "Ask me first is on: Migz proposes each new ad, and nothing goes live until you approve it.",
      ),
      actions(button(input.auto ? "Watch Migz work" : "Approve Migz's proposals", `${input.dashboardUrl}/dashboard/brain`, true)),
    ],
  };
}

/** What one review did: its summary, the changes made, and anything waiting for the agent's OK. */
export function reviewSummaryMessage(input: {
  summary: string;
  applied: string[];
  proposed: { title: string; detail: string | null }[];
  dashboardUrl: string;
}): SlackMessage | null {
  if (!input.applied.length && !input.proposed.length) return null;
  const waiting = input.proposed.length;
  const text = waiting
    ? `Migz has ${waiting} change${waiting === 1 ? "" : "s"} waiting for your OK: ${input.proposed.map((p) => p.title).join("; ")}`
    : `Migz made ${input.applied.length} change${input.applied.length === 1 ? "" : "s"}: ${input.applied.join("; ")}`;
  const blocks: unknown[] = [header(":brain: Migz reviewed your ads")];
  if (input.summary.trim()) blocks.push(section(esc(input.summary.trim())));
  if (input.applied.length) blocks.push(section(`*What Migz did*\n${input.applied.slice(0, 8).map((t) => `• ${esc(t)}`).join("\n")}`));
  if (waiting) {
    blocks.push(divider, section(`:bulb: *${waiting} change${waiting === 1 ? "" : "s"} waiting for your OK*`));
    for (const p of input.proposed.slice(0, 5)) blocks.push(section(`*${esc(p.title)}*${p.detail ? `\n${esc(cut(p.detail, 300))}` : ""}`));
    if (waiting > 5) blocks.push(context(`…and ${waiting - 5} more.`));
    blocks.push(
      actions(button("Review and approve", `${input.dashboardUrl}/dashboard/brain#approvals`, true)),
      context("Proposals expire after 48 hours if you don't act."),
    );
  } else {
    blocks.push(actions(button("Open the Migz brain", `${input.dashboardUrl}/dashboard/brain`)));
  }
  return { text, blocks };
}

/** A batch finished: what it spent and booked, and a nudge to start the next one. */
export function batchEndedMessage(input: { budgetCents: number; spentCents: number; bookedCalls: number; dashboardUrl: string }): SlackMessage {
  const per = input.bookedCalls ? ` (${usd(Math.round(input.spentCents / input.bookedCalls))} each)` : "";
  const left = Math.max(0, input.budgetCents - input.spentCents);
  return {
    text: `Your campaign batch ended: ${input.bookedCalls} booked call${input.bookedCalls === 1 ? "" : "s"} from ${usd(input.spentCents)}`,
    blocks: [
      header(":checkered_flag: Your campaign batch ended"),
      section(
        `*${input.bookedCalls} booked call${input.bookedCalls === 1 ? "" : "s"}* from ${usd(input.spentCents)} of ad spend${per}.${left ? ` ${usd(left)} stays in your balance.` : ""}\nYour ads are paused. Everything this batch taught Migz carries into the next one.`,
      ),
      actions(button("Start your next batch", `${input.dashboardUrl}/dashboard`, true)),
    ],
  };
}

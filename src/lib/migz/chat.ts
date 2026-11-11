import "server-only";
import { supabaseAdmin } from "@/lib/supabase-admin";
import type { Agent } from "@/lib/booking/data";
import { sendSlackMessage } from "@/lib/slack";
import { getBalanceCents } from "@/lib/dashboard/queries";
import { callModel, defaultCreateMessage } from "@/lib/migz/router";
import { sendSms } from "@/lib/migz/sms";
import { approveVideos, requestVideoChanges, videosToReview } from "@/lib/migz/video-review";
import { parseJson, textOf } from "@/lib/migz/video-revise-merge";
import { chatSystemPrompt, DAILY_MESSAGE_LIMIT, HELP_REPLY, parseCommand, START_REPLY, STOP_REPLY } from "@/lib/migz/chat-rules";

// Two-way chat with Migz over text and Slack: status questions answered from real numbers, approvals by
// keyword, change requests for a waiting video.

export type Channel = "sms" | "slack";
const appUrl = () => (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");
const dollars = (c: number) => `$${(c / 100).toFixed(0)}`;

async function statusFor(agent: Agent) {
  const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const [{ data: spend }, { count: booked }, { count: live }, balance] = await Promise.all([
    supabaseAdmin.from("ad_insights_daily").select("spend_cents").eq("agent_id", agent.id).gte("date", since.slice(0, 10)),
    supabaseAdmin.from("bookings").select("id", { count: "exact", head: true }).eq("agent_id", agent.id).gte("created_at", since),
    supabaseAdmin.from("ads").select("id", { count: "exact", head: true }).eq("agent_id", agent.id).eq("status", "ACTIVE"),
    getBalanceCents(agent.id),
  ]);
  const cents = (spend ?? []).reduce((n, r) => n + (r.spend_cents as number), 0);
  return `Last 7 days: ${dollars(cents)} spent, ${booked ?? 0} booked. Ads on: ${live ?? 0}. Ad funds left: ${dollars(balance)}.`;
}

async function deliver(agent: Agent, channel: Channel, text: string) {
  if (channel === "sms") await sendSms(agent.sms_phone!, text);
  else await sendSlackMessage(agent.slack_user_id!, text);
  await supabaseAdmin.from("migz_messages").insert({ agent_id: agent.id, channel, direction: "out", body: text });
}

export async function handleInbound(agent: Agent, channel: Channel, text: string, externalId: string) {
  const { error: dup } = await supabaseAdmin.from("migz_messages").insert({ agent_id: agent.id, channel, direction: "in", body: text.slice(0, 2000), external_id: externalId });
  if (dup) return; // a retried webhook, or the migration hasn't run

  const dayAgo = new Date(Date.now() - 86_400_000).toISOString();
  const { count } = await supabaseAdmin.from("migz_messages").select("id", { count: "exact", head: true }).eq("agent_id", agent.id).eq("direction", "in").gte("created_at", dayAgo);
  if ((count ?? 0) > DAILY_MESSAGE_LIMIT) return;

  const command = parseCommand(text);
  if (channel === "sms" && command === "stop") {
    await deliver(agent, channel, STOP_REPLY);
    await supabaseAdmin.from("agents").update({ sms_opt_in_at: null }).eq("id", agent.id);
    return;
  }
  if (channel === "sms" && command === "start") {
    await supabaseAdmin.from("agents").update({ sms_opt_in_at: new Date().toISOString() }).eq("id", agent.id);
    return deliver(agent, channel, START_REPLY);
  }
  if (channel === "sms" && !agent.sms_opt_in_at) return; // never reply to someone who opted out
  if (command === "help") return deliver(agent, channel, HELP_REPLY);

  const videos = await videosToReview(agent.id);
  if (command === "approve") {
    const n = await approveVideos(agent.id, videos.map((v) => v.id));
    return deliver(agent, channel, n ? `Approved ${n} video${n === 1 ? "" : "s"}. On the way to your ads.` : "Nothing's waiting for approval right now.");
  }

  const { data: history } = await supabaseAdmin.from("migz_messages").select("direction, body").eq("agent_id", agent.id).order("created_at", { ascending: false }).limit(9);
  const turns = (history ?? []).reverse();
  const dashboardUrl = `${appUrl()}/dashboard`;
  try {
    const { message } = await callModel({
      task: "copy_check",
      tier: "sonnet",
      agentId: agent.id,
      runId: null,
      createMessage: defaultCreateMessage,
      params: {
        max_tokens: 3000, // room for thinking before the JSON
        system: chatSystemPrompt({ company: agent.full_name, dashboardUrl, waitingVideos: videos.length }),
        messages: [{ role: "user", content: `Status right now: ${await statusFor(agent)}\n\nConversation so far, newest last:\n${turns.map((t) => `${t.direction === "in" ? "Owner" : "Migz"}: ${t.body}`).join("\n")}` }],
      },
    });
    const r = parseJson(textOf(message.content as { type: string; text?: string }[]));
    let reply = typeof r.reply === "string" && r.reply.trim() ? r.reply.trim().slice(0, 600) : "Got it. Check your dashboard for the latest.";
    if (typeof r.change_note === "string" && r.change_note.trim().length >= 3 && videos.length === 1) {
      const done = await requestVideoChanges(agent, videos[0].id, r.change_note);
      if (done === "remaking") reply = "On it. I'm remaking that video from your note and I'll send the new version.";
      else if (done === "staff") reply = "Got it. Someone from our team will take a look at that video and follow up.";
    }
    await deliver(agent, channel, reply);
  } catch (e) {
    console.error("migz chat failed", e);
    await deliver(agent, channel, `Sorry, I couldn't pull that up just now. Your dashboard has the latest: ${dashboardUrl}`).catch(() => {});
  }
}

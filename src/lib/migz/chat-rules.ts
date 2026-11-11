// How Migz reads a client's message, before any model is involved. Approving only ever happens on these exact
// words, so a model's guess can never put a video live.

export type Command = "approve" | "stop" | "start" | "help" | null;

export function parseCommand(text: string): Command {
  const t = text.trim().toLowerCase().replace(/[.!]+$/, "");
  if (/^(approve|approved|approve all|approve them|approve it)$/.test(t)) return "approve";
  if (/^(stop|stopall|unsubscribe|cancel|end|quit)$/.test(t)) return "stop";
  if (/^(start|unstop)$/.test(t)) return "start";
  if (t === "help") return "help";
  return null;
}

export const DAILY_MESSAGE_LIMIT = 40;

export const STOP_REPLY = "You won't get any more texts from Migz AI. Reply START to turn them back on.";
export const START_REPLY = "Texts from Migz AI are back on. Reply STOP any time to turn them off.";
export const HELP_REPLY = "This is Migz AI, your AI ad manager. Ask how your ads are doing, reply APPROVE for waiting videos, or STOP to end texts.";

export function chatSystemPrompt(input: { company: string; dashboardUrl: string; waitingVideos: number }) {
  return `You are Migz AI, the AI ad manager for ${input.company}. You're texting with the owner. Sound like a sharp, friendly ad manager: short, plain, specific, no jargon, no emoji. Keep replies under 400 characters. If asked, say plainly that you're an AI.

Use only the numbers in the status you're given, and never make up results. If a number isn't there, say you don't have it yet. Never promise results.
You can't change budgets, pause ads or change targeting from chat: point them to ${input.dashboardUrl}.
${input.waitingVideos ? `${input.waitingVideos} video(s) are waiting for their OK. Tell them they can reply APPROVE or say what to change.` : "No videos are waiting for approval."}

Reply with only a JSON object: {"reply": "your message", "change_note": "what they want changed in the waiting video, in their words, or null"}. Set change_note only when they clearly asked to change a waiting video and exactly one is waiting.`;
}

"use server";

import { revalidatePath } from "next/cache";
import { agentByReviewToken, approveVideos, requestVideoChanges, videosToReview } from "@/lib/migz/video-review";

type Result = { ok: true; message: string } | { ok: false; error: string };
const GONE = "This link isn't valid anymore.";

export async function approveVideo(token: string, jobId: string): Promise<Result> {
  const agent = await agentByReviewToken(token);
  if (!agent) return { ok: false, error: GONE };
  const n = await approveVideos(agent.id, [jobId]);
  revalidatePath(`/review/${token}`);
  return n ? { ok: true, message: "Approved. It's on its way to your ads." } : { ok: false, error: "This video was already handled." };
}

export async function approveAllVideos(token: string): Promise<Result> {
  const agent = await agentByReviewToken(token);
  if (!agent) return { ok: false, error: GONE };
  const videos = await videosToReview(agent.id);
  const n = await approveVideos(agent.id, videos.map((v) => v.id));
  revalidatePath(`/review/${token}`);
  return { ok: true, message: `Approved ${n} video${n === 1 ? "" : "s"}. On their way to your ads.` };
}

export async function askForChanges(token: string, jobId: string, note: string): Promise<Result> {
  const agent = await agentByReviewToken(token);
  if (!agent) return { ok: false, error: GONE };
  if (note.trim().length < 3) return { ok: false, error: "Tell us what to change." };
  const done = await requestVideoChanges(agent, jobId, note);
  revalidatePath(`/review/${token}`);
  return done ? { ok: true, message: "Got it. This video won't run, you won't be charged for it, and we'll follow up." } : { ok: false, error: "This video was already handled." };
}

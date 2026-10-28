import { advanceJobById, validWebhookToken } from "@/lib/migz/creative-jobs";

export const maxDuration = 300; // storing a video (narration, logo, end card) can take minutes

// Higgsfield calls this when a generation finishes. Its webhooks aren't signed, so the URL carries a
// per-job HMAC token, and we treat the call only as a nudge: the job re-reads the authoritative
// status from Higgsfield's API rather than trusting the payload.
export async function POST(req: Request) {
  const url = new URL(req.url);
  const jobId = url.searchParams.get("job") ?? "";
  const token = url.searchParams.get("token") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(jobId) || !validWebhookToken(jobId, token)) {
    // 4xx tells Higgsfield not to retry
    return new Response("Forbidden", { status: 403 });
  }
  const stage = await advanceJobById(jobId);
  return Response.json({ ok: true, stage });
}

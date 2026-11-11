import { supabaseAdmin } from "@/lib/supabase-admin";
import { advanceJobById } from "@/lib/migz/creative-jobs";
import { validRenderSignature, type EditState } from "@/lib/edit/dispatch";
import { checkRender, type RenderStats } from "@/lib/edit/qc";
import { alertAdmin } from "@/lib/migz/slack";

export const maxDuration = 300; // finishing the job stores the video

// The render worker reports a finished (or failed) edit here, signed with the shared secret. A finished file must
// pass the render checks (loudness, loop frame, no black or frozen frames) or the simple edit is used instead.
export async function POST(req: Request) {
  const raw = await req.text();
  if (!validRenderSignature(raw, req.headers.get("x-render-signature") ?? "")) return new Response("Forbidden", { status: 403 });
  const body = JSON.parse(raw) as { jobId: string; ok: boolean; stats?: RenderStats; error?: string; seconds?: number };
  if (!/^[0-9a-f-]{36}$/i.test(body.jobId)) return new Response("Bad job", { status: 400 });
  const { data: job } = await supabaseAdmin.from("creative_jobs").select("id, edit_state, agent_id").eq("id", body.jobId).maybeSingle();
  const state = job?.edit_state as EditState | null;
  if (!job || state?.status !== "rendering") return Response.json({ ok: true, ignored: true }); // already settled

  const checks = body.ok && body.stats ? checkRender(body.stats) : [];
  const failed = checks.filter((c) => !c.pass);
  const next: EditState = body.ok && !failed.length
    ? { ...state, status: "done", render_checks: checks, stats: body.stats, seconds: body.seconds }
    : { ...state, status: "failed", render_checks: checks, stats: body.stats, error: body.error ?? `Render checks failed: ${failed.map((c) => `${c.name} (${c.detail})`).join("; ")}` };
  await supabaseAdmin.from("creative_jobs").update({ edit_state: next, updated_at: new Date().toISOString() }).eq("id", job.id);
  if (next.status === "failed") await alertAdmin(`Presenter video ${job.id}: the full edit failed (${next.error}). Using the simple edit.`).catch(() => {});
  const stage = await advanceJobById(job.id);
  return Response.json({ ok: true, status: next.status, stage });
}

import { bookTool, checkFitTool, doNotCallTool, openTimesTool, validToolSecret } from "@/lib/voice/tools";
import { checkinDoNotCall, reportIssueTool, sendReferralTool } from "@/lib/roofing/checkin";

// The voice agent's server tools, called by ElevenLabs mid-call: /api/voice/tools/open_times,
// /api/voice/tools/check_fit, /api/voice/tools/book_inspection and /api/voice/tools/do_not_call; and the post-job check-in agent's
// /api/voice/tools/send_referral, /api/voice/tools/report_issue and do_not_call (with job_id). See
// docs/voice-agent.md for their setup.
export const runtime = "nodejs";
export const preferredRegion = "iad1";
export const maxDuration = 30;

export async function POST(req: Request, { params }: { params: Promise<{ tool: string }> }) {
  if (!validToolSecret(req)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { tool } = await params;
  const body = ((await req.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  try {
    switch (tool) {
      case "open_times":
        return Response.json(await openTimesTool(body));
      case "check_fit":
        return Response.json(await checkFitTool(body));
      case "book_inspection":
        return Response.json(await bookTool(body, new URL(req.url).origin));
      case "do_not_call":
        // The check-in agent passes job_id, the speed-to-lead agent lead_id
        if (body.job_id) return Response.json((await checkinDoNotCall(body.job_id)) ?? { error: "Unknown job." });
        return Response.json(await doNotCallTool(body));
      case "send_referral":
        return Response.json(await sendReferralTool(body));
      case "report_issue":
        return Response.json(await reportIssueTool(body));
      default:
        return Response.json({ error: "Unknown tool" }, { status: 404 });
    }
  } catch (e) {
    console.error(`[voice] tool ${tool} failed`, e);
    // The agent reads this, so it says what to do rather than what broke
    return Response.json({ error: "That didn't work. Tell them the team will call to confirm a time." });
  }
}

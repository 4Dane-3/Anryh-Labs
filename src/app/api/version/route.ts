// Which version of the app is live. A dashboard tab compares this with the version it loaded with, and
// offers a refresh when they differ (a tab left open across an update can't talk to the new server).
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({ v: process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.VERCEL_DEPLOYMENT_ID ?? "dev" }, { headers: { "Cache-Control": "no-store" } });
}

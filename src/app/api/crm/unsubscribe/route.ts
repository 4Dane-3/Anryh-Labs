import { unsubscribe, validToken } from "@/lib/crm/unsubscribe";
import { appUrl } from "@/lib/crm/email";

// One-click unsubscribe (RFC 8058): mail apps POST here from the List-Unsubscribe header. A GET (someone
// opening the header link) goes to the page with a button, so link scanners can't unsubscribe anyone.

export async function POST(req: Request) {
  const t = new URL(req.url).searchParams.get("t");
  if (!validToken(t)) return new Response("Not found", { status: 404 });
  await unsubscribe(t);
  return new Response("Unsubscribed", { status: 200 });
}

export async function GET(req: Request) {
  const t = new URL(req.url).searchParams.get("t");
  return Response.redirect(`${appUrl()}/unsubscribe/${validToken(t) ? t : "x"}`, 303);
}

import { submitReferrals } from "@/lib/roofing/referrals";

// The referral page's submit: { token, rows: [{ name, phone, email, address }], permission: true }
export const runtime = "nodejs";
export const preferredRegion = "iad1";

export async function POST(req: Request) {
  const body = ((await req.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  if (typeof body.token !== "string") return Response.json({ error: "This link isn't valid any more." }, { status: 404 });
  const res = await submitReferrals(body.token, { rows: body.rows, permission: body.permission });
  if (!res.ok) return Response.json({ error: res.error, problems: res.problems ?? [] }, { status: res.status });
  return Response.json(res);
}

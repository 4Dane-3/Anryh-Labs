import { NextResponse } from "next/server";
import { VIEW_AS_COOKIE } from "@/lib/auth";
import { isPrefetch } from "@/lib/prefetch";

// Stop viewing an agent's dashboard and go back to the admin dashboard.
export async function GET(req: Request) {
  // Never on a prefetch: that would end the view the moment the page loads
  if (isPrefetch(req)) return new Response(null, { status: 204 });
  const res = NextResponse.redirect(new URL("/admin", req.url));
  res.cookies.delete(VIEW_AS_COOKIE);
  return res;
}

import { NextResponse } from "next/server";
import { VIEW_AS_COOKIE } from "@/lib/auth";

// Stop viewing an agent's dashboard and go back to the admin dashboard.
export async function GET(req: Request) {
  const res = NextResponse.redirect(new URL("/admin", req.url));
  res.cookies.delete(VIEW_AS_COOKIE);
  return res;
}

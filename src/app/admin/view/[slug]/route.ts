import { NextResponse } from "next/server";
import { isAnryhAdmin, VIEW_AS_COOKIE } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase-admin";

// Staff: open an agent's dashboard exactly as they see it, view only (the proxy blocks every change).
export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  if (!(await isAnryhAdmin())) return new Response("Not found", { status: 404 });
  const { slug } = await params;
  const { data: agent } = await supabaseAdmin.from("agents").select("id").eq("slug", slug).maybeSingle();
  if (!agent) return new Response("No agent with that link", { status: 404 });
  const to = new URL(req.url).searchParams.get("to");
  const res = NextResponse.redirect(new URL(to && /^\/dashboard(\/|$)/.test(to) ? to : "/dashboard", req.url));
  res.cookies.set(VIEW_AS_COOKIE, agent.id, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 4 * 3600 });
  return res;
}

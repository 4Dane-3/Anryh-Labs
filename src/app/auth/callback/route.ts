import { NextResponse } from "next/server";
import { createSupabaseServer } from "@/lib/supabase-server";

// Lands here from the emailed sign-in link; trades the one-time code for a session cookie.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");

  if (code) {
    const supabase = await createSupabaseServer();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL("/dashboard", url.origin));
  }

  return NextResponse.redirect(new URL("/login?error=link", url.origin));
}

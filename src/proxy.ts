import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { isOurHost } from "@/lib/booking/ad-domain";
import { LANDING_PATHS } from "@/lib/landing/groups";

// A roofer's ad address (book.theirroofing.com) shows their booking page at its root: host -> slug, cached a minute
const hostSlugs = new Map<string, { slug: string | null; at: number }>();
async function slugForHost(host: string) {
  const hit = hostSlugs.get(host);
  if (hit && Date.now() - hit.at < 60_000) return hit.slug;
  const { data } = await supabaseAdmin.from("agents").select("slug").eq("ad_domain", host).maybeSingle();
  const slug = (data?.slug as string | undefined) ?? null;
  hostSlugs.set(host, { slug, at: Date.now() });
  return slug;
}

// Refreshes the Supabase session cookie on dashboard and admin requests, sends signed-out visitors to
// /login, and keeps the dashboard read-only while staff are viewing an agent's account.
export async function proxy(request: NextRequest) {
  // On a roofer's own ad address, the root is their booking page, /prepare its follow-up questions, and
  // /roof-replacement (and the other ad groups) each ad group's landing page
  const path = request.nextUrl.pathname;
  const landing = LANDING_PATHS.includes(path.slice(1));
  if (path === "/" || path === "/prepare" || landing) {
    const host = (request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "").toLowerCase().replace(/:\d+$/, "");
    if (!isOurHost(host)) {
      const slug = await slugForHost(host).catch(() => null);
      if (slug) {
        const url = request.nextUrl.clone();
        url.pathname = path === "/" ? `/${slug}` : landing ? `/${slug}/p${path}` : `/${slug}/prepare`;
        return NextResponse.rewrite(url);
      }
    }
    return NextResponse.next();
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const devBypass = process.env.NODE_ENV === "development" && !!process.env.DEV_AGENT_SLUG;
  const { pathname } = request.nextUrl;

  // Staff viewing an agent's dashboard can look, never change: no form posts, server actions or uploads
  const viewing = !!request.cookies.get("anryh_view_as")?.value;
  if (viewing && request.method !== "GET" && request.method !== "HEAD" && (pathname.startsWith("/dashboard") || pathname.startsWith("/api/dashboard"))) {
    return new NextResponse("View only: you're looking at an agent's dashboard. Go back to the admin dashboard to stop viewing.", { status: 403 });
  }

  if (!user && !devBypass && (pathname.startsWith("/dashboard") || pathname.startsWith("/admin"))) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }

  // A signed-in user with no agent account is sent to /login?error=noaccount and must be allowed to stay
  // there (to sign out or use another email); only bounce them when there's no error to show.
  if ((user || devBypass) && pathname === "/login" && !request.nextUrl.searchParams.get("error")) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: ["/", "/prepare", "/roof-replacement", "/roof-repair", "/storm-damage", "/roof-inspection", "/gutters", "/siding", "/dashboard/:path*", "/api/dashboard/:path*", "/admin/:path*", "/admin", "/login"],
};

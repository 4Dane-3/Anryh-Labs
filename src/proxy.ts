import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

// Refreshes the Supabase session cookie on dashboard and admin requests, sends signed-out visitors to
// /login, and keeps the dashboard read-only while staff are viewing an agent's account.
export async function proxy(request: NextRequest) {
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
  matcher: ["/dashboard/:path*", "/api/dashboard/:path*", "/admin/:path*", "/admin", "/login"],
};

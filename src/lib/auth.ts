import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { createSupabaseServer } from "@/lib/supabase-server";
import { getAgentBySlug, type Agent } from "@/lib/booking/data";

/** Local development only: skip login and act as this agent. Ignored in production builds. */
export function devAgentSlug() {
  return process.env.NODE_ENV === "development" ? process.env.DEV_AGENT_SLUG || null : null;
}

/**
 * The agent for the signed-in user. On first sign-in, a user whose verified email matches an
 * unclaimed agent row is linked to it, so creating the login in Supabase Auth is all the setup needed.
 */
export const getCurrentAgent = cache(async (): Promise<Agent | null> => {
  // Staff looking at an agent's dashboard (view only: the proxy blocks every change while it's set)
  const viewing = await getViewAs();
  if (viewing) return viewing;

  const devSlug = devAgentSlug();
  if (devSlug) return getAgentBySlug(devSlug);

  const supabase = await createSupabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: linked } = await supabaseAdmin
    .from("agents")
    .select("*")
    .eq("user_id", user.id)
    .eq("active", true)
    .maybeSingle();
  if (linked) return linked;

  if (!user.email || !user.email_confirmed_at) return null;

  const { data: claimed } = await supabaseAdmin
    .from("agents")
    .update({ user_id: user.id })
    .ilike("email", user.email)
    .is("user_id", null)
    .eq("active", true)
    .select("*")
    .maybeSingle();
  return claimed;
});

export async function requireAgent(): Promise<Agent> {
  const agent = await getCurrentAgent();
  // Signed in but not linked to an agent: /login (with a reason) rather than a bare /login, which the
  // proxy would send straight back to /dashboard, looping forever
  if (!agent) redirect("/login?error=noaccount");
  return agent;
}

/** Anryh Labs staff (by verified email in ANRYH_ADMIN_EMAILS): the admin dashboard, AI budgets, Review now. */
export const isAnryhAdmin = cache(async () => {
  // Local development only, to try the admin dashboard without a staff login
  if (process.env.NODE_ENV === "development" && process.env.DEV_ADMIN === "1") return true;
  const admins = (process.env.ANRYH_ADMIN_EMAILS ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
  if (!admins.length) return false;
  const supabase = await createSupabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return !!user?.email && !!user.email_confirmed_at && admins.includes(user.email.toLowerCase());
});

/** The cookie set by /admin/view/<slug>; the proxy keeps the dashboard read-only while it's present. */
export const VIEW_AS_COOKIE = "anryh_view_as";

/** The agent staff are viewing as, if any. Ignored for anyone who isn't staff. */
export const getViewAs = cache(async (): Promise<Agent | null> => {
  const id = (await cookies()).get(VIEW_AS_COOKIE)?.value;
  if (!id || !(await isAnryhAdmin())) return null;
  const { data } = await supabaseAdmin.from("agents").select("*").eq("id", id).maybeSingle();
  return (data as Agent | null) ?? null;
});

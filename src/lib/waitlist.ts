import { getSupabase } from "@/lib/supabase";

export async function submitWaitlistSignup(email: string) {
  const { error } = await getSupabase().from("waitlist_signups").insert({ email });

  if (error) throw error;
}

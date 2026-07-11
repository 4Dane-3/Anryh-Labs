import { supabase } from "@/lib/supabase";

export async function submitWaitlistSignup(email: string) {
  const { error } = await supabase.from("waitlist_signups").insert({ email });

  if (error) throw error;
}

import { createBrowserClient } from "@supabase/ssr";

// Browser client for sign-in/sign-out; it stores the session in cookies the server can read.
export function createSupabaseBrowser() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}

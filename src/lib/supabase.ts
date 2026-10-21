import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Created on first use rather than at import, so prerendering pages that import this
// (e.g. /pairo) doesn't crash the build when the env vars aren't set for that environment.
let client: SupabaseClient | null = null;

export function getSupabase() {
  if (!client) {
    client = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );
  }
  return client;
}

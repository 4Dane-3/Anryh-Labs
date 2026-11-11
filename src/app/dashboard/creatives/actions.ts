"use server";

import { revalidatePath } from "next/cache";
import { requireAgent } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase-admin";

/** Whether Migz's videos wait for the agent's OK before going to Meta. Videos already waiting keep waiting. */
export async function setVideoApproval(on: boolean): Promise<{ ok: boolean; error?: string }> {
  const agent = await requireAgent();
  const { error } = await supabaseAdmin.from("agents").update({ video_approval: on }).eq("id", agent.id);
  if (error) return { ok: false, error: "Couldn't save that. Try again." };
  revalidatePath("/dashboard/creatives");
  return { ok: true };
}

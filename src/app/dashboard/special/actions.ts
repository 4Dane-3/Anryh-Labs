"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { requireAgent } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { isRoofer } from "@/lib/verticals";
import { checkCopyFor } from "@/lib/migz/guardrails";
import { pauseAdsPromoting } from "@/lib/roofing/special-check";
import { runMigz } from "@/lib/migz/agent";

type Result = { ok: true; message: string } | { ok: false; error: string };

/** "Still running": confirmed for another week. */
export async function confirmSpecial(): Promise<Result> {
  const agent = await requireAgent();
  if (!isRoofer(agent)) return { ok: false, error: "Only for roofing accounts." };
  const { error } = await supabaseAdmin.from("agent_brand").update({ special_confirmed_at: new Date().toISOString() }).eq("agent_id", agent.id);
  if (error) return { ok: false, error: "Couldn't save that." };
  revalidatePath("/dashboard/special");
  return { ok: true, message: "Thanks. Migz keeps featuring it and asks again next week." };
}

/**
 * "It's ended": the new special (or none) takes its place, and with `replaceAds` the live ads promoting the old
 * one are paused and Migz reviews the account, which makes new ads for any ad set left short.
 */
export async function replaceSpecial(input: { newSpecial: string; replaceAds: boolean }): Promise<Result> {
  const agent = await requireAgent();
  if (!isRoofer(agent)) return { ok: false, error: "Only for roofing accounts." };
  const next = input.newSpecial.trim().slice(0, 60);
  if (next) {
    const problem = checkCopyFor("roofing", next);
    if (problem) return { ok: false, error: problem };
  }
  const { data: row } = await supabaseAdmin.from("agent_brand").select("deals").eq("agent_id", agent.id).maybeSingle();
  const old = (row?.deals as string[] | undefined)?.[0] ?? null;
  const rest = ((row?.deals as string[] | undefined) ?? []).slice(1).filter((d) => d !== next);
  const now = new Date().toISOString();
  const { error } = await supabaseAdmin
    .from("agent_brand")
    .upsert({ agent_id: agent.id, deals: next ? [next, ...rest] : rest, special_confirmed_at: next ? now : null, special_asked_at: null, updated_at: now });
  if (error) return { ok: false, error: "Couldn't save that." };
  // The presenter's featured offer follows the first deal (the script reads it)
  await supabaseAdmin.from("agent_presenters").update({ offer: next || rest[0] || null, updated_at: now }).eq("agent_id", agent.id);

  let paused = 0;
  if (input.replaceAds && old) {
    paused = await pauseAdsPromoting(agent, old);
    if (paused && agent.onboarding_completed_at) after(() => runMigz(agent, { trigger: "manual" }).then(() => undefined).catch((e) => console.error("special replace review failed", e)));
  }
  revalidatePath("/dashboard/special");
  revalidatePath("/dashboard/creatives/presenter");
  const swapped = next ? `Your ads feature "${next}" from now on.` : "Your ads won't feature a special until you add one.";
  return {
    ok: true,
    message: input.replaceAds
      ? paused
        ? `${swapped} Paused ${paused} ad${paused === 1 ? "" : "s"} promoting the old one; Migz is making new ones${agent.migz_mode === "approve" ? " for you to approve" : ""}.`
        : `${swapped} No live ads mentioned the old special, so nothing was paused.`
      : swapped,
  };
}

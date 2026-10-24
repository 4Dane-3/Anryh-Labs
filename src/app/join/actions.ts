"use server";

import { headers } from "next/headers";
import { submitJoinRequest, type JoinResult } from "@/lib/referrals";
import type { JoinInput } from "@/lib/referrals-core";

// The join form on /join/<slug>. Public, so: a hidden field bots fill in, and a per-visitor limit.
const WINDOW_MS = 10 * 60_000;
const MAX_PER_WINDOW = 5;
const hits = new Map<string, number[]>();

export async function requestToJoin(referrerSlug: string, input: Partial<JoinInput> & { website?: string }): Promise<JoinResult> {
  if (input.website) return { ok: true, name: "" }; // the hidden field: only bots fill it in
  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= MAX_PER_WINDOW) return { ok: false, error: "That's a lot of requests from here. Try again in a few minutes." };
  hits.set(ip, [...recent, now]);
  if (hits.size > 5000) hits.clear();
  return submitJoinRequest(String(referrerSlug).slice(0, 80), input);
}

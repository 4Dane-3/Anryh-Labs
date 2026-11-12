import "server-only";
import type { Agent } from "@/lib/booking/data";
import type { BrandInitial } from "@/components/dashboard/BrandSetup";
import type { PresenterInitial } from "@/components/dashboard/PresenterSetup";
import { getPresenter } from "@/lib/migz/presenter";
import { getBrandRow } from "@/lib/edit/brand-scan";
import { DEFAULT_BRAND } from "@/lib/edit/brand";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { allMedia } from "@/lib/roofing/job-media";
import { findVoices } from "@/lib/voice/ad-voices";
import type { MediaItem } from "@/components/dashboard/JobMediaSetup";
import type { CreativeContextInitial } from "@/components/dashboard/CreativeContext";

/** What the brand and on-camera forms start with, shared by Start here and the presenter page. */
export async function creativeSetup(agent: Agent): Promise<{ brand: BrandInitial; presenter: PresenterInitial; context: CreativeContextInitial }> {
  const [p, b, voices] = await Promise.all([getPresenter(agent.id).catch(() => null), getBrandRow(agent.id).catch(() => null), findVoices().catch(() => ({ voices: [], more: false }))]);
  return {
    context: {
      voice: p?.elevenlabs_voice_id ? "ready" : p?.voice_sample_path ? "saved" : null,
      adVoice: { id: p?.ad_voice_id ?? null, name: p?.ad_voice_name ?? null },
      voices,
      consented: !!p?.consent_at,
      name: p?.on_camera_name ?? "",
      company: agent.full_name ?? "",
      media: await signMedia(allMedia(p?.job_media, p?.job_photo_paths)),
    },
    brand: {
      website: b?.website ?? "",
      headingFont: b?.heading_font ?? DEFAULT_BRAND.headingFont,
      bodyFont: b?.body_font ?? DEFAULT_BRAND.bodyFont,
      background: b?.background ?? DEFAULT_BRAND.background,
      text: b?.text_color ?? DEFAULT_BRAND.text,
      accent: b?.accent ?? DEFAULT_BRAND.accent,
      fontNote: b?.font_note ?? null,
      // Before the brand existed, the offer and badge lived on the presenter
      deals: b?.deals.length ? b.deals : p?.offer ? [p.offer] : [],
      certifications: b?.certifications.length ? b.certifications : p?.badge ? [p.badge] : [],
      license: b?.license ?? "",
      warranties: b?.warranties ?? [],
      hasLogo: !!b?.logo_path,
    },
    presenter: {
      mode: p?.mode ?? "ai",
      towns: p?.towns.join(", ") ?? agent.service_area ?? "",
      onCameraName: p?.on_camera_name ?? "",
      onCameraRole: p?.on_camera_role ?? "Owner",
      onCameraVoice: p?.on_camera_voice === "female" ? "female" : "male",
      onCameraPronunciation: p?.on_camera_pronunciation ?? "",
      look: { status: p?.look_status ?? null, preview: p?.look_preview_url ?? null },
      consentName: p?.consent_name ?? "",
      consented: !!p?.consent_at,
      photos: p?.photo_paths.length ?? 0,
      jobs: p?.job_photo_paths.length ?? 0,
      film: !!p?.film_path,
      voice: !!p?.elevenlabs_voice_id,
    },
  };
}

/** Their job photos and clips with short-lived links, for the thumbnails. */
export async function signMedia(media: ReturnType<typeof allMedia>): Promise<MediaItem[]> {
  if (!media.length) return [];
  const { data } = await supabaseAdmin.storage.from("creatives").createSignedUrls(media.map((m) => m.path), 3600);
  return media.map((m, i) => ({ ...m, url: data?.[i]?.signedUrl ?? null }));
}

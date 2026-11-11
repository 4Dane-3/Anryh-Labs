import { requireAgent } from "@/lib/auth";
import { PageHeader } from "@/components/dashboard/ui";
import { PresenterSetup } from "@/components/dashboard/PresenterSetup";
import { BrandSetup } from "@/components/dashboard/BrandSetup";
import { getPresenter } from "@/lib/migz/presenter";
import { getBrandRow } from "@/lib/edit/brand-scan";
import { DEFAULT_BRAND } from "@/lib/edit/brand";

export const dynamic = "force-dynamic";

export default async function PresenterPage() {
  const agent = await requireAgent();
  const [p, b] = await Promise.all([getPresenter(agent.id), getBrandRow(agent.id).catch(() => null)]);
  return (
    <>
      <PageHeader title="You in your videos" description="Owner-on-camera ads with big captions, your towns and brand, and a clear call to action. Nothing goes live until you approve it." />
      <div className="max-w-2xl space-y-5">
        <BrandSetup
          initial={{
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
          }}
        />
        <PresenterSetup
          initial={{
            mode: p?.mode ?? "ai",
            towns: p?.towns.join(", ") ?? agent.service_area ?? "",
            onCameraName: p?.on_camera_name ?? "",
            onCameraRole: p?.on_camera_role ?? "Owner",
            onCameraVoice: p?.on_camera_voice === "female" ? "female" : "male",
            consentName: p?.consent_name ?? "",
            consented: !!p?.consent_at,
            photos: p?.photo_paths.length ?? 0,
            jobs: p?.job_photo_paths.length ?? 0,
            film: !!p?.film_path,
            voice: !!p?.elevenlabs_voice_id,
          }}
        />
      </div>
    </>
  );
}

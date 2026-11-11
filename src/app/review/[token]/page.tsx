import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { agentByReviewToken, videosToReview } from "@/lib/migz/video-review";
import { ReviewList } from "./ReviewList";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Review your videos", robots: { index: false, follow: false }, referrer: "no-referrer" };

// Where a video approval email or Slack message lands: phone-sized, no login, the link itself is the key.
export default async function ReviewPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const agent = await agentByReviewToken(token);
  if (!agent) notFound();
  const videos = await videosToReview(agent.id);
  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8 text-slate-900 [color-scheme:light]">
      <div className="mx-auto max-w-md">
        <p className="text-sm font-medium text-slate-500">Migz AI</p>
        {videos.length ? (
          <>
            <h1 className="mt-2 text-2xl font-bold tracking-tight">{videos.length === 1 ? "Your new video" : `Your ${videos.length} new videos`}</h1>
            <p className="mt-2 text-[15px] leading-relaxed text-slate-600">Nothing goes live until you approve it.</p>
          </>
        ) : (
          <>
            <h1 className="mt-2 text-2xl font-bold tracking-tight">You&apos;re all caught up.</h1>
            <p className="mt-2 text-[15px] leading-relaxed text-slate-600">No videos are waiting for you right now.</p>
          </>
        )}
        <ReviewList token={token} videos={videos} />
      </div>
    </main>
  );
}

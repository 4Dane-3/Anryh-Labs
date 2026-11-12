"use client";

import { VoiceRecorder } from "@/components/dashboard/VoiceRecorder";
import { VoicePicker } from "@/components/dashboard/VoicePicker";
import { JobMediaSetup, type MediaItem } from "@/components/dashboard/JobMediaSetup";
import type { AdVoice } from "@/lib/voice/ad-voices";

export type CreativeContextInitial = {
  voice: "ready" | "saved" | null; // their own voice. ready: cloned; saved: recorded, waiting to be cloned
  adVoice: { id: string | null; name: string | null }; // the voice their ads are spoken in
  voices: { voices: AdVoice[]; more: boolean }; // the first page of voices to pick from
  consented: boolean;
  name: string; // who's on camera, for the lines to read
  company: string;
  media: MediaItem[];
};

/** Ad Creative AI Context: what every Migz ad is made from, beyond the business details. Their voice speaks the
 * presenter videos and voiceovers; their real photos and clips go into videos as cut-aways and image ads as the
 * photo itself. */
export function CreativeContext({ initial, onSaved }: { initial: CreativeContextInitial; onSaved?: () => void }) {
  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <p className="text-sm font-semibold text-fg">The voice for your ads</p>
        <p className="text-[13px] text-fg-muted">Speaks your on-camera videos and your voiceovers.</p>
        <VoicePicker initial={initial.adVoice} own={initial.voice} first={initial.voices} onSaved={onSaved} />
        <details className="rounded-lg border border-line p-3" open={!!initial.voice}>
          <summary className="cursor-pointer text-sm text-fg">Or use your own voice</summary>
          <div className="mt-3">
            <VoiceRecorder name={initial.name} company={initial.company} have={initial.voice} consented={initial.consented} onDone={() => onSaved?.()} />
          </div>
        </details>
      </section>
      <section className="space-y-2">
        <p className="text-sm font-semibold text-fg">Your job photos and clips</p>
        <p className="text-[13px] text-fg-muted">Used in your videos as cut-aways and in your image ads as the photo itself, with your text on it.</p>
        <JobMediaSetup initial={initial.media} onSaved={onSaved} />
      </section>
    </div>
  );
}

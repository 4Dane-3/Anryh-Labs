"use client";

import { useState, useSyncExternalStore } from "react";
import { Check, Copy, Share2 } from "lucide-react";
import { Button } from "@/components/dashboard/ui";

const noop = () => () => {};

/** The agent's invite link with Copy, and Share where the device has a share sheet (phones). */
export function InviteLink({ url, name }: { url: string; name: string }) {
  const [copied, setCopied] = useState(false);
  // false on the server and in the first render, so the page hydrates cleanly; true after on phones
  const canShare = useSyncExternalStore(noop, () => typeof navigator.share === "function", () => false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // older browsers: select the text so it can be copied by hand
      document.getElementById("invite-link")?.focus();
      return;
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const share = () =>
    navigator
      .share({ title: "Join me on Migz", text: `${name.split(" ")[0]} invited you to Migz, the AI that runs your Meta ads and books consultations for you.`, url })
      .catch(() => {});

  return (
    <div className="flex flex-col gap-2 sm:flex-row">
      <input
        id="invite-link"
        readOnly
        value={url}
        onFocus={(e) => e.currentTarget.select()}
        aria-label="Your invite link"
        className="min-w-0 flex-1 rounded-lg border border-line bg-ink-high px-3 py-2 font-mono text-[13px] text-fg focus:border-brand/60 focus:outline-none"
      />
      <div className="flex gap-2">
        <Button variant="primary" onClick={copy} className="flex-1 sm:flex-none">
          {copied ? <Check className="size-4" /> : <Copy className="size-4" />} {copied ? "Copied" : "Copy link"}
        </Button>
        {canShare && (
          <Button variant="secondary" onClick={share} aria-label="Share your invite link">
            <Share2 className="size-4" /> Share
          </Button>
        )}
      </div>
    </div>
  );
}

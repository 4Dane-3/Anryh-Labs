"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveSettings } from "@/app/admin/crm/actions";
import type { CrmSettings } from "@/lib/crm/types";
import { Button, inputClass, Label } from "@/components/dashboard/ui";
import { Modal, TIMEZONES } from "@/components/admin/crm/shared";
import { cn } from "@/lib/utils";

export function CrmSettingsForm({ open, onClose, settings, zoom }: { open: boolean; onClose: () => void; settings: CrmSettings; zoom: boolean }) {
  return (
    <Modal open={open} onClose={onClose} title="Meeting settings">
      {open && <Form settings={settings} zoom={zoom} onClose={onClose} />}
    </Modal>
  );
}

function Form({ settings, zoom, onClose }: { settings: CrmSettings; zoom: boolean; onClose: () => void }) {
  const router = useRouter();
  const [f, setF] = useState({
    meetingUrl: settings.meeting_url ?? "",
    meetingDetails: settings.meeting_details ?? "",
    fromName: settings.from_name,
    replyTo: settings.reply_to ?? "",
    timezone: settings.timezone,
    defaultMinutes: settings.default_minutes,
  });
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  const zones = TIMEZONES.includes(f.timezone) ? TIMEZONES : [f.timezone, ...TIMEZONES];

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          setError(null);
          const r = await saveSettings({ ...f, defaultMinutes: Number(f.defaultMinutes) });
          if (!r.ok) return setError(r.error);
          router.refresh();
          onClose();
        });
      }}
    >
      <div>
        <Label htmlFor="s-url">Default meeting link</Label>
        <input id="s-url" className={inputClass} value={f.meetingUrl} onChange={set("meetingUrl")} placeholder="Your Zoom personal room or Google Meet link" />
        <p className="mt-1 text-[12px] text-fg-faint">Every new meeting starts with this link; change it per meeting when you need to. {zoom ? "Zoom is connected, so you can also have each meeting get its own Zoom link." : ""}</p>
      </div>
      <div>
        <Label htmlFor="s-details">Default meeting ID / passcode (optional)</Label>
        <textarea id="s-details" rows={2} className={inputClass} value={f.meetingDetails} onChange={set("meetingDetails")} placeholder={"Meeting ID: 123 456 7890\nPasscode: 123456"} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="s-from">Invites come from</Label>
          <input id="s-from" className={inputClass} value={f.fromName} onChange={set("fromName")} placeholder="Dane at Anryh Labs" />
        </div>
        <div>
          <Label htmlFor="s-reply">Replies go to</Label>
          <input id="s-reply" type="email" className={inputClass} value={f.replyTo} onChange={set("replyTo")} placeholder="you@anryhlabs.com" />
        </div>
        <div>
          <Label htmlFor="s-tz">Calendar timezone</Label>
          <select id="s-tz" className={cn(inputClass, "[&>option]:bg-[#26282a]")} value={f.timezone} onChange={set("timezone")}>
            {zones.map((z) => (
              <option key={z} value={z}>
                {z.replace(/_/g, " ")}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="s-min">Default length (minutes)</Label>
          <input id="s-min" type="number" min={5} max={480} step={5} className={inputClass} value={f.defaultMinutes} onChange={set("defaultMinutes")} />
        </div>
      </div>
      {error && <p className="text-[13px] text-bad">{error}</p>}
      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
      </div>
    </form>
  );
}

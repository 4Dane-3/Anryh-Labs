"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, Loader2, Send } from "lucide-react";
import { assignVerticalAction, inviteClientAction } from "@/app/admin/actions";
import { Button, inputClass } from "@/components/dashboard/ui";
import { VERTICAL_LABELS, type Vertical } from "@/lib/verticals";
import { cn } from "@/lib/utils";

// The order staff see: the newest businesses first
const TYPES: Vertical[] = ["hair_clinic", "roofing", "insurance"];

/** Staff invite a client and choose their business type: setup is built for it, and the client is never asked. */
export function InviteClient() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [vertical, setVertical] = useState<Vertical>("hair_clinic");
  const [sendEmail, setSendEmail] = useState(true);
  const [pending, start] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; text: string; link?: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    start(async () => {
      setResult(null);
      setCopied(false);
      const r = await inviteClientAction({ name, email, vertical, sendEmail });
      if (!r.ok) return setResult({ ok: false, text: r.error });
      setResult({ ok: true, text: r.message, link: r.link });
      setName("");
      setEmail("");
      router.refresh();
    });
  };

  return (
    <form onSubmit={submit} className="space-y-3 border-b border-line px-5 pb-5">
      <div>
        <p className="text-sm font-semibold text-fg">Invite a client</p>
        <p className="text-[12px] text-fg-muted">Choose what they are and setup is built for it. They sign in with their email (a code, no password).</p>
      </div>
      <div className="grid gap-2 sm:grid-cols-[1fr_1fr]">
        <label className="block text-[12px] text-fg-muted">
          Business name
          <input className={cn(inputClass, "mt-1")} value={name} onChange={(e) => setName(e.target.value)} placeholder="Lee Hair Clinic" required />
        </label>
        <label className="block text-[12px] text-fg-muted">
          Their email
          <input className={cn(inputClass, "mt-1")} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="owner@leehairclinic.com" required />
        </label>
      </div>
      <div>
        <p className="mb-1.5 text-[12px] text-fg-muted">Business type</p>
        <div className="grid gap-2 sm:grid-cols-3">
          {TYPES.map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={vertical === v}
              onClick={() => setVertical(v)}
              className={cn("h-10 rounded-xl border text-[13px]", vertical === v ? "border-brand/60 bg-brand/10 text-fg" : "border-line text-fg-muted hover:border-line-strong hover:text-fg")}
            >
              {VERTICAL_LABELS[v]}
            </button>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-[13px] text-fg-muted">
          <input type="checkbox" checked={sendEmail} onChange={(e) => setSendEmail(e.target.checked)} />
          Email them the invite
        </label>
        <Button type="submit" disabled={pending || !name.trim() || !email.trim()}>
          {pending ? <Loader2 className="animate-spin" /> : <Send />}
          {sendEmail ? "Send invite" : "Create account"}
        </Button>
      </div>
      {result && (
        <div className={cn("flex flex-wrap items-center gap-2 text-[13px]", result.ok ? "text-good" : "text-bad")} role="status">
          <span>{result.text}</span>
          {result.link && (
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-md bg-white/[0.06] px-2 py-0.5 text-[12px] text-fg hover:bg-white/[0.1]"
              onClick={() => {
                void navigator.clipboard?.writeText(result.link!).then(() => setCopied(true), () => {});
              }}
            >
              {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />} {copied ? "Copied" : "Copy sign-in link"}
            </button>
          )}
        </div>
      )}
    </form>
  );
}

/** One account's business type, changeable until their setup is done. */
export function VerticalPicker({ agentId, vertical, locked }: { agentId: string; vertical: Vertical; locked: boolean }) {
  const router = useRouter();
  const [value, setValue] = useState(vertical);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div>
      <select
        aria-label="Business type"
        className="rounded-md border border-line bg-transparent px-1.5 py-1 text-[12px] text-fg disabled:opacity-60"
        value={value}
        disabled={pending || locked}
        title={locked ? "Their campaign already started: the business type is set" : "Change their business type"}
        onChange={(e) => {
          const next = e.target.value as Vertical;
          const before = value;
          setValue(next);
          setError(null);
          start(async () => {
            const r = await assignVerticalAction(agentId, next);
            if (!r.ok) {
              setValue(before);
              setError(r.error);
            } else router.refresh();
          });
        }}
      >
        {TYPES.map((v) => (
          <option key={v} value={v}>
            {VERTICAL_LABELS[v]}
          </option>
        ))}
      </select>
      {error && <p className="mt-1 max-w-[200px] text-[11px] text-bad">{error}</p>}
    </div>
  );
}

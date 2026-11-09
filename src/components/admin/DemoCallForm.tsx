"use client";

import { useState, useTransition } from "react";
import { motion } from "framer-motion";
import { HeartHandshake, Phone, PhoneCall } from "lucide-react";
import { placeDemoCall, placeDemoCheckinCall } from "@/app/admin/demo-call/actions";
import { Button, inputClass, Label, Panel } from "@/components/dashboard/ui";
import { TIMEZONES } from "@/components/admin/crm/shared";
import { cn } from "@/lib/utils";

type Account = { id: string; full_name: string; timezone: string };
type Kind = "lead" | "checkin";

const KINDS: { id: Kind; label: string; hint: string; icon: typeof Phone }[] = [
  { id: "lead", label: "New lead call", hint: "Emma calls seconds after a form, qualifies and books", icon: PhoneCall },
  { id: "checkin", label: "Post-job check-in", hint: "Emma checks the job went well, then emails the review and referral links", icon: HeartHandshake },
];

export function DemoCallForm({ accounts, ready, checkinReady, initialKind }: { accounts: Account[]; ready: boolean; checkinReady: boolean; initialKind: Kind }) {
  const demo = accounts.find((a) => /demo/i.test(a.full_name)) ?? accounts[0];
  const [kind, setKind] = useState<Kind>(initialKind);
  const [f, setF] = useState({
    accountId: demo?.id ?? "",
    phone: "",
    company: "",
    // new lead
    firstName: "",
    business: "roofing" as "roofing" | "life insurance",
    city: "",
    address: "",
    roofIssue: "",
    interest: "",
    serviceArea: "",
    hours: "",
    timezone: demo?.timezone ?? "America/Los_Angeles",
    // check-in
    name: "",
    email: "",
    rewardDollars: "100",
    goal: "5",
  });
  const [confirmed, setConfirmed] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  const roof = f.business === "roofing";
  const isReady = kind === "lead" ? ready : checkinReady;

  const call = () =>
    start(async () => {
      setMsg(null);
      const r =
        kind === "lead"
          ? await placeDemoCall(f)
          : await placeDemoCheckinCall({ accountId: f.accountId, phone: f.phone, name: f.name, email: f.email, address: f.address, company: f.company, rewardDollars: f.rewardDollars, goal: f.goal });
      setMsg(r.ok ? { ok: true, text: r.message } : { ok: false, text: r.error });
    });

  const switchTo = (k: Kind) => {
    setKind(k);
    setMsg(null);
    window.history.replaceState(null, "", k === "checkin" ? "?kind=checkin" : window.location.pathname);
  };

  return (
    <div className="space-y-4">
      <div role="tablist" aria-label="Which call" className="grid gap-2 sm:grid-cols-2">
        {KINDS.map(({ id, label, hint, icon: Icon }) => {
          const on = kind === id;
          return (
            <button
              key={id}
              role="tab"
              aria-selected={on}
              onClick={() => switchTo(id)}
              className={cn(
                "relative flex items-start gap-3 rounded-2xl border p-4 text-left backdrop-blur-xl transition-colors",
                on ? "border-brand/50 text-fg" : "border-line bg-ink-raised text-fg-muted hover:border-line-strong hover:text-fg",
              )}
            >
              {on && <motion.span layoutId="demo-kind" className="absolute inset-0 rounded-2xl bg-brand/10" transition={{ type: "spring", stiffness: 500, damping: 40 }} />}
              <span className={cn("relative flex size-9 shrink-0 items-center justify-center rounded-xl", on ? "bg-brand text-brand-fg" : "bg-white/10")}>
                <Icon className="size-4" />
              </span>
              <span className="relative">
                <span className="block text-sm font-semibold">{label}</span>
                <span className="mt-0.5 block text-[13px] text-fg-muted">{hint}</span>
              </span>
            </button>
          );
        })}
      </div>

      <Panel className="space-y-5 p-5">
        {!isReady && (
          <p className="rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 text-sm text-bad">
            {kind === "lead"
              ? "The voice agent isn't set up on this server yet, so calls can't be placed."
              : "The check-in agent isn't set up on this server yet. Add ELEVENLABS_CHECKIN_AGENT_ID in Vercel and redeploy."}
          </p>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Label>Number to call</Label>
            <input className={inputClass} inputMode="tel" placeholder="(253) 555-0100" value={f.phone} onChange={set("phone")} />
          </div>
          <div>
            <Label>Company Emma speaks for</Label>
            <input className={inputClass} value={f.company} onChange={set("company")} placeholder="Summit Roofing" />
          </div>

          {kind === "lead" ? (
            <>
              <div>
                <Label>Their first name</Label>
                <input className={inputClass} value={f.firstName} onChange={set("firstName")} placeholder="Mike" />
              </div>
              <div>
                <Label>Business</Label>
                <select className={inputClass} value={f.business} onChange={set("business")}>
                  <option value="roofing">Roofing</option>
                  <option value="life insurance">Life insurance</option>
                </select>
              </div>
              <div>
                <Label>City</Label>
                <input className={inputClass} value={f.city} onChange={set("city")} placeholder="Kent" />
              </div>
              {roof ? (
                <>
                  <div>
                    <Label>Roof address (optional)</Label>
                    <input className={inputClass} value={f.address} onChange={set("address")} placeholder="123 Main St" />
                  </div>
                  <div>
                    <Label>What they told us (optional)</Label>
                    <input className={inputClass} value={f.roofIssue} onChange={set("roofIssue")} placeholder="Leak after the storm" />
                  </div>
                </>
              ) : (
                <div className="sm:col-span-2">
                  <Label>Interested in (optional)</Label>
                  <input className={inputClass} value={f.interest} onChange={set("interest")} placeholder="Term life" />
                </div>
              )}
              <div>
                <Label>Service area (blank = the account&apos;s)</Label>
                <input className={inputClass} value={f.serviceArea} onChange={set("serviceArea")} placeholder="Kent, Auburn, Renton" />
              </div>
              <div>
                <Label>Inspection hours (blank = the account&apos;s)</Label>
                <input className={inputClass} value={f.hours} onChange={set("hours")} placeholder="Monday to Friday 8am–5pm" />
              </div>
              <div>
                <Label>Their time zone</Label>
                <select className={inputClass} value={f.timezone} onChange={set("timezone")}>
                  {(TIMEZONES.includes(f.timezone) ? TIMEZONES : [f.timezone, ...TIMEZONES]).map((z) => (
                    <option key={z} value={z}>{z}</option>
                  ))}
                </select>
              </div>
            </>
          ) : (
            <>
              <div>
                <Label>Customer&apos;s name</Label>
                <input className={inputClass} value={f.name} onChange={set("name")} placeholder="Mike Johnson" />
              </div>
              <div>
                <Label>Their email (optional)</Label>
                <input className={inputClass} type="email" value={f.email} onChange={set("email")} placeholder="Emma reads it back, or asks" />
              </div>
              <div>
                <Label>Job address (optional)</Label>
                <input className={inputClass} value={f.address} onChange={set("address")} placeholder="123 Main St, Kent" />
              </div>
              <div>
                <Label>Gift card ($)</Label>
                <input className={inputClass} inputMode="decimal" value={f.rewardDollars} onChange={set("rewardDollars")} />
              </div>
              <div>
                <Label>Referrals needed</Label>
                <input className={inputClass} inputMode="numeric" value={f.goal} onChange={set("goal")} />
              </div>
            </>
          )}

          <div className={kind === "lead" ? "" : "sm:col-span-2"}>
            <Label>{kind === "lead" ? "Calendar a booking lands on" : "Account the demo job goes on"}</Label>
            <select className={inputClass} value={f.accountId} onChange={set("accountId")}>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>{a.full_name}</option>
              ))}
            </select>
          </div>
        </div>

        <p className="text-[13px] text-fg-muted">
          {kind === "lead"
            ? "If Emma books a time on the call, it's a real booking on that account's calendar. Use a demo account, not a client."
            : "If they say it went well, the review and referral email really goes out to the email they confirm, from that account. Use a demo account, not a client."}
        </p>
        <label className="flex items-start gap-2 text-sm text-fg">
          <input type="checkbox" className="mt-1 accent-[var(--color-brand)]" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
          This person asked me to call them for this demo.
        </label>
        <div className="flex flex-wrap items-center gap-4">
          <Button variant="primary" onClick={call} disabled={pending || !isReady || !confirmed || !f.phone || !f.accountId}>
            <Phone /> {pending ? "Calling…" : kind === "lead" ? "Call now" : "Call for check-in"}
          </Button>
          {msg && <p className={msg.ok ? "text-sm text-good" : "text-sm text-bad"}>{msg.text}</p>}
        </div>
      </Panel>
    </div>
  );
}

"use client";

import { useState, useTransition } from "react";
import { Phone } from "lucide-react";
import { placeDemoCall } from "@/app/admin/demo-call/actions";
import { Button, inputClass, Label, Panel } from "@/components/dashboard/ui";
import { TIMEZONES } from "@/components/admin/crm/shared";

type Account = { id: string; full_name: string; timezone: string };

export function DemoCallForm({ accounts, ready }: { accounts: Account[]; ready: boolean }) {
  const demo = accounts.find((a) => /demo/i.test(a.full_name));
  const [f, setF] = useState({
    accountId: (demo ?? accounts[0])?.id ?? "",
    phone: "",
    firstName: "",
    company: "",
    business: "roofing" as "roofing" | "life insurance",
    city: "",
    address: "",
    roofIssue: "",
    interest: "",
    serviceArea: "",
    hours: "",
    timezone: (demo ?? accounts[0])?.timezone ?? "America/Los_Angeles",
  });
  const [confirmed, setConfirmed] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  const roof = f.business === "roofing";

  const call = () =>
    start(async () => {
      setMsg(null);
      const r = await placeDemoCall(f);
      setMsg(r.ok ? { ok: true, text: r.message } : { ok: false, text: r.error });
    });

  return (
    <Panel className="space-y-5 p-5">
      {!ready && <p className="rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 text-sm text-bad">The voice agent isn&apos;t set up on this server yet, so calls can&apos;t be placed.</p>}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Label>Number to call</Label>
          <input className={inputClass} inputMode="tel" placeholder="(253) 555-0100" value={f.phone} onChange={set("phone")} />
        </div>
        <div>
          <Label>Their first name</Label>
          <input className={inputClass} value={f.firstName} onChange={set("firstName")} placeholder="Mike" />
        </div>
        <div>
          <Label>Company Emma speaks for</Label>
          <input className={inputClass} value={f.company} onChange={set("company")} placeholder="Summit Roofing" />
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
        <div>
          <Label>Calendar a booking lands on</Label>
          <select className={inputClass} value={f.accountId} onChange={set("accountId")}>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>{a.full_name}</option>
            ))}
          </select>
        </div>
      </div>
      <p className="text-[13px] text-fg-muted">If Emma books a time on the call, it&apos;s a real booking on that account&apos;s calendar. Use a demo account, not a client.</p>
      <label className="flex items-start gap-2 text-sm text-fg">
        <input type="checkbox" className="mt-1" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
        This person asked me to call them for this demo.
      </label>
      <div className="flex items-center gap-4">
        <Button variant="primary" onClick={call} disabled={pending || !ready || !confirmed || !f.phone || !f.accountId}>
          <Phone /> {pending ? "Calling…" : "Call now"}
        </Button>
        {msg && <p className={msg.ok ? "text-sm text-good" : "text-sm text-bad"}>{msg.text}</p>}
      </div>
    </Panel>
  );
}

"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { DateTime } from "luxon";
import { Check, X } from "lucide-react";
import type { AdminAffiliates } from "@/lib/referrals";
import { approveJoin, declineJoin, linkReferrer, pauseReferralCredit } from "@/app/admin/actions";
import { Badge, Button, EmptyState, inputClass, Panel, PanelHeader, Switch } from "@/components/dashboard/ui";
import { cn } from "@/lib/utils";

// Staff only: join requests from agents' invite links, who referred whom, and the 1% credit each earns.

const usd = (c: number) => `$${(c / 100).toFixed(2)}`;
const ago = (iso: string) => DateTime.fromISO(iso).toRelative() ?? "";

type Msg = { ok: boolean; text: string } | null;
type Result = { ok: true; message?: string } | { ok: false; error: string };

function useAction() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<Msg>(null);
  const run = (fn: () => Promise<Result>) =>
    start(async () => {
      setMsg(null);
      try {
        const r = await fn();
        setMsg(r.ok ? { ok: true, text: r.message ?? "Saved." } : { ok: false, text: r.error });
        if (r.ok) router.refresh();
      } catch {
        setMsg({ ok: false, text: "That didn't go through. Reload and try again." });
      }
    });
  return { pending, msg, run };
}

function Request({ r }: { r: AdminAffiliates["pending"][number] }) {
  const { pending, msg, run } = useAction();
  return (
    <li className="px-5 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[13px] font-medium text-fg">
            {r.name} <span className="font-normal text-fg-muted">· invited by {r.referrer}</span>
          </p>
          <p className="mt-0.5 font-mono text-[11px] text-fg-faint">
            {[r.email, r.phone, r.states.length ? r.states.join(", ") : null, ago(r.createdAt)].filter(Boolean).join(" · ")}
          </p>
          {r.note && <p className="mt-1.5 max-w-xl text-[12px] text-fg-muted">“{r.note}”</p>}
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="primary" disabled={pending} onClick={() => run(() => approveJoin(r.id))}>
            <Check className="size-3.5" /> Approve &amp; create account
          </Button>
          <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => declineJoin(r.id))}>
            <X className="size-3.5" /> Decline
          </Button>
        </div>
      </div>
      {msg && <p className={cn("mt-2 text-[12px]", msg.ok ? "text-good" : "text-bad")}>{msg.text}</p>}
    </li>
  );
}

function AgentRow({ a, all }: { a: AdminAffiliates["agents"][number]; all: AdminAffiliates["agents"] }) {
  const { pending, msg, run } = useAction();
  const [paused, setPaused] = useState(a.paused);
  return (
    <li className="grid gap-3 px-5 py-3.5 lg:grid-cols-[1.2fr_1fr_1.4fr] lg:items-center">
      <div className="min-w-0">
        <p className="truncate text-[13px] font-medium text-fg">
          {a.name} <span className="font-mono text-[11px] font-normal text-fg-faint">/{a.slug}</span>
        </p>
        <p className="font-mono text-[11px] text-fg-muted">
          {a.referrals ? `${a.referrals} referral${a.referrals === 1 ? "" : "s"} · ${usd(a.referralDepositsCents)} deposited · ${usd(a.earnedCents)} earned` : "No referrals"}
        </p>
      </div>
      <label className="flex items-center gap-2 text-[12px] text-fg-muted">
        <span className="shrink-0">Referred by</span>
        <select
          aria-label={`Who referred ${a.name}`}
          className={cn(inputClass, "py-1.5 text-[13px]")}
          value={a.referredBy ?? ""}
          disabled={pending}
          onChange={(e) => run(() => linkReferrer(a.id, e.target.value || null))}
        >
          <option value="">Nobody</option>
          {all.filter((o) => o.id !== a.id).map((o) => (
            <option key={o.id} value={o.id}>{o.name}</option>
          ))}
        </select>
      </label>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Switch
          label={`Referral credit for ${a.name}`}
          checked={!paused}
          disabled={pending}
          onChange={(on) => {
            setPaused(!on);
            run(() => pauseReferralCredit(a.id, !on));
          }}
        />
        <span className="text-[12px] text-fg-muted">{paused ? "Credit paused" : "Earns credit"}</span>
        {msg && <span className={cn("basis-full text-[12px]", msg.ok ? "text-good" : "text-bad")}>{msg.text}</span>}
      </div>
    </li>
  );
}

export function AffiliatesPanel({ data }: { data: AdminAffiliates }) {
  const earned = data.agents.reduce((s, a) => s + a.earnedCents, 0);
  const linked = data.agents.filter((a) => a.referredBy).length;
  return (
    <Panel id="affiliates" className="scroll-mt-6">
      <PanelHeader
        title="Affiliates"
        description={`Agents earn 1% of their referrals' deposits as ad credit. ${linked} referred agent${linked === 1 ? "" : "s"} · ${usd(earned)} credit given so far.`}
        action={data.pending.length ? <Badge tone="accent">{data.pending.length} waiting</Badge> : undefined}
      />
      {!data.ready ? (
        <EmptyState title="Run the affiliates migration">Run 20261109000000_affiliates.sql in Supabase to switch referrals on.</EmptyState>
      ) : (
        <>
          <div className="border-b border-line">
            <p className="px-5 pt-4 font-mono text-[11px] text-fg-faint">Requests to join</p>
            {data.pending.length ? (
              <ul className="divide-y divide-line">{data.pending.map((r) => <Request key={r.id} r={r} />)}</ul>
            ) : (
              <p className="px-5 pb-4 pt-1.5 text-[13px] text-fg-muted">Nothing waiting. Requests from agents&apos; invite links show up here and in your Slack.</p>
            )}
            {!!data.decided.length && (
              <p className="px-5 pb-4 font-mono text-[11px] text-fg-faint">
                Recently: {data.decided.map((d) => `${d.name} (${d.status}, via ${d.referrer})`).join(" · ")}
              </p>
            )}
          </div>
          <p className="px-5 pt-4 font-mono text-[11px] text-fg-faint">Every agent · linking a referrer only counts deposits from then on</p>
          <ul className="divide-y divide-line">{data.agents.map((a) => <AgentRow key={a.id} a={a} all={data.agents} />)}</ul>
        </>
      )}
    </Panel>
  );
}

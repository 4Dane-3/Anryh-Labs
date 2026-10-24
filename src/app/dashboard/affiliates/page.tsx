import { DateTime } from "luxon";
import { requireAgent } from "@/lib/auth";
import { getAffiliateSummary } from "@/lib/referrals";
import { REFERRAL_RATE, referralCreditCents } from "@/lib/referrals-core";
import { MIN_DEPOSIT_CENTS } from "@/lib/campaign";
import { usd } from "@/lib/dashboard/format";
import { InviteLink } from "@/components/dashboard/InviteLink";
import { Badge, EmptyState, PageHeader, Panel, PanelHeader } from "@/components/dashboard/ui";

const PCT = `${REFERRAL_RATE * 100}%`;

function Stat({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <Panel className="px-5 py-4">
      <p className="text-[13px] text-fg-muted">{label}</p>
      <p className="mt-1.5 text-2xl font-semibold tracking-tight tabular-nums">{value}</p>
      {sub && <p className="mt-0.5 text-[12px] text-fg-faint">{sub}</p>}
    </Panel>
  );
}

const STATUS = { pending: { label: "Waiting for approval", tone: "accent" }, declined: { label: "Not approved", tone: "neutral" }, approved: { label: "Joined", tone: "good" } } as const;

export default async function AffiliatesPage() {
  const agent = await requireAgent();
  const s = await getAffiliateSummary(agent);
  const date = (iso: string) => DateTime.fromISO(iso).setZone(agent.timezone).toFormat("LLL d, yyyy");
  const example = MIN_DEPOSIT_CENTS;

  return (
    <>
      <PageHeader
        title="Affiliates"
        description={`Invite other agents to Migz. Every time someone you invited adds funds, ${PCT} of it is added to your own ad funds, for as long as they're on Migz.`}
      />

      {!s.ready && (
        <p className="mb-6 rounded-lg border border-line bg-ink-raised px-4 py-3 text-[13px] text-fg-muted">Affiliates are being switched on. Your link works shortly.</p>
      )}

      <div className="grid gap-3 lg:grid-cols-5">
        <Panel className="lg:col-span-3">
          <PanelHeader title="Your invite link" description="Send it by text, email or DM to any licensed agent." />
          <div className="px-5 py-5">
            <InviteLink url={s.link} name={agent.full_name} />
          </div>
          <ol className="space-y-3 border-t border-line px-5 py-5 text-[13px] text-fg-muted">
            {[
              "They open your link and request an invite.",
              "Anryh Labs approves it and sets up their account, linked to you.",
              `Whenever they add funds, ${PCT} goes into your ad funds automatically: ${usd(referralCreditCents(example), { cents: true })} on a ${usd(example)} deposit.`,
            ].map((t, i) => (
              <li key={t} className="flex gap-3">
                <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-brand/15 text-[11px] font-semibold text-brand">{i + 1}</span>
                <span>{t}</span>
              </li>
            ))}
          </ol>
          <p className="border-t border-line px-5 py-4 text-[12px] text-fg-faint">
            Credit is ad funds for your own campaigns, not cash, and it can&apos;t be withdrawn. If a deposit is refunded or charged back, its credit is taken back.
          </p>
        </Panel>

        <div className="grid content-start gap-3 lg:col-span-2">
          <Stat label="Agents you've referred" value={s.referrals.length} sub={s.requests.filter((r) => r.status === "pending").length ? `${s.requests.filter((r) => r.status === "pending").length} waiting for approval` : undefined} />
          <Stat label="Credit earned" value={usd(s.earnedCents, { cents: true })} sub={`${usd(s.monthCents, { cents: true })} this month`} />
        </div>
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <Panel>
          <PanelHeader title="Your referrals" description="Agents who joined through you, and the credit each has earned you." />
          {s.referrals.length || s.requests.length ? (
            <ul className="divide-y divide-line">
              {s.referrals.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-3 px-5 py-3">
                  <span className="min-w-0">
                    <span className="block truncate text-sm text-fg">{r.name}</span>
                    <span className="block text-[12px] text-fg-faint">Joined {date(r.joinedAt)}</span>
                  </span>
                  <span className="text-sm tabular-nums text-good">{usd(r.creditCents, { cents: true })}</span>
                </li>
              ))}
              {s.requests.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-3 px-5 py-3">
                  <span className="min-w-0">
                    <span className="block truncate text-sm text-fg-muted">{r.name}</span>
                    <span className="block text-[12px] text-fg-faint">Requested {date(r.createdAt)}</span>
                  </span>
                  <Badge tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Badge>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="No referrals yet">When someone requests an invite with your link, they show up here.</EmptyState>
          )}
        </Panel>

        <Panel>
          <PanelHeader title="Credit history" description="Every credit is also in your Ad funds history." />
          {s.credits.length ? (
            <ul className="divide-y divide-line">
              {s.credits.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-3 px-5 py-3">
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] text-fg">{c.description}</span>
                    <span className="block text-[12px] text-fg-faint">{date(c.createdAt)}</span>
                  </span>
                  <span className={`text-sm tabular-nums ${c.amountCents < 0 ? "text-bad" : "text-good"}`}>
                    {c.amountCents < 0 ? "−" : "+"}
                    {usd(Math.abs(c.amountCents), { cents: true })}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="No credit yet">The first credit arrives when someone you referred adds funds.</EmptyState>
          )}
        </Panel>
      </div>
    </>
  );
}

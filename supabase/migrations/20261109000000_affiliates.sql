-- Affiliates: an agent who brings in another agent earns 1% of every deposit that agent makes, for as
-- long as they're on Migz. It's paid as ad credit in the referrer's own wallet, never as cash. One level
-- only (no credit on the people *they* bring in). Someone joins through /join/<referrer's slug>: the
-- request lands here, staff approve it in the admin dashboard, and approving creates their account
-- already linked to the referrer. Service role only (no RLS policies), like the rest of the wallet.

-- Who referred each agent. Set by staff (on approval, or attached later in the admin); changing it only
-- affects deposits made after the change.
alter table public.agents
  add column referred_by uuid references public.agents (id) on delete set null,
  add column referred_at timestamptz,
  add column referral_paused boolean not null default false, -- staff froze this agent's referral credit
  add constraint agents_not_self_referred check (referred_by is null or referred_by <> id);

create index agents_referred_by_idx on public.agents (referred_by) where referred_by is not null;

-- The credit is its own wallet row kind, pointing at the agent whose deposit earned it. The original
-- kind check was created inline (unnamed), so find it by definition rather than guess its name.
do $$
declare c text;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.wallet_transactions'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%kind%'
  loop
    execute format('alter table public.wallet_transactions drop constraint %I', c);
  end loop;
end $$;

alter table public.wallet_transactions
  add constraint wallet_transactions_kind_check
    check (kind in ('deposit', 'ad_spend', 'fee', 'refund', 'adjustment', 'referral_credit')),
  add column related_agent_id uuid references public.agents (id) on delete set null; -- for referral credit: whose deposit

create index wallet_transactions_related_idx on public.wallet_transactions (related_agent_id) where related_agent_id is not null;

-- Requests to join from a referral link, until staff approve or decline them
create table public.referral_requests (
  id uuid primary key default gen_random_uuid(),
  referrer_id uuid not null references public.agents (id) on delete cascade,
  full_name text not null check (char_length(full_name) between 2 and 120),
  email text not null check (char_length(email) between 3 and 200),
  phone text check (char_length(phone) <= 40),
  licensed_states text[] not null default '{}',
  note text check (char_length(note) <= 1000),
  status text not null default 'pending' check (status in ('pending', 'approved', 'declined')),
  agent_id uuid references public.agents (id) on delete set null, -- the account created on approval
  decided_by text,
  decided_at timestamptz,
  created_at timestamptz not null default now()
);

-- One open request per email, however many times the form is sent
create unique index referral_requests_pending_email on public.referral_requests (lower(email)) where status = 'pending';
create index referral_requests_referrer_idx on public.referral_requests (referrer_id, created_at desc);

alter table public.referral_requests enable row level security;

notify pgrst, 'reload schema';

-- Agent dashboard: login link, editable intake questions, ad funds ledger, creatives, testimonials,
-- and daily ad metrics + an AI adjustment log (both filled by the Meta integration once it's connected).
-- Like the booking tables, everything is RLS-locked with no policies: only the server reads or writes.

-- 1. Agents: link to a Supabase Auth login, plus ad settings
alter table public.agents
  add column user_id uuid unique references auth.users (id) on delete set null,
  add column daily_budget_cents int not null default 2000 check (daily_budget_cents between 0 and 10000000),
  add column ads_paused boolean not null default false;

-- 2. Bookings: private notes the agent keeps about a client
alter table public.bookings add column agent_notes text;

-- 3. Editable intake questions. Agents with no rows get the defaults from src/lib/booking/questions.ts.
create table public.intake_questions (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.agents (id) on delete cascade,
  key text not null check (key ~ '^[a-z0-9_]{1,40}$'),
  step smallint not null check (step between 1 and 4),
  sort int not null default 0,
  label text not null check (char_length(label) between 1 and 200),
  kind text not null check (kind in ('short_text', 'long_text', 'choice', 'date')),
  options text[] not null default '{}',
  allow_other boolean not null default false,
  placeholder text,
  -- hide this question when another question's answer equals a value (e.g. no existing policy)
  hidden_when_key text,
  hidden_when_value text,
  enabled boolean not null default true,
  unique (agent_id, key)
);

create index intake_questions_agent_idx on public.intake_questions (agent_id, step, sort);

-- Answers move to one jsonb column: { key: { label, value } }. The label is a snapshot so answers
-- still read correctly after the agent renames or deletes a question.
alter table public.intake_responses add column answers jsonb not null default '{}';

update public.intake_responses r
set answers = coalesce((
  select jsonb_object_agg(x.k, jsonb_build_object('label', x.l, 'value', x.v))
  from (values
    ('date_of_birth', 'Date of birth', r.date_of_birth::text),
    ('gender', 'Gender', r.gender),
    ('marital_status', 'Marital status', r.marital_status),
    ('nicotine', 'Nicotine use', r.nicotine),
    ('goal', 'What is your goal with life insurance?', r.goal),
    ('reason', 'What is the reason you inquired?', r.reason),
    ('existing_coverage', 'Do you have existing coverage or a policy?', r.existing_coverage),
    ('policy_description', 'Description of policy (Term, Whole Life, IUL, Final Expense)', r.policy_description),
    ('current_premium', 'How much do you pay for it?', r.current_premium),
    ('current_coverage', 'How much coverage do you have?', r.current_coverage),
    ('affordable_budget', 'How much can you afford?', r.affordable_budget),
    ('coverage_needed', 'How much coverage do you need?', r.coverage_needed),
    ('notes', 'Extra notes for your agent', r.notes)
  ) as x (k, l, v)
  where x.v is not null and x.v <> ''
), '{}'::jsonb);

alter table public.intake_responses
  drop column date_of_birth,
  drop column gender,
  drop column marital_status,
  drop column nicotine,
  drop column existing_coverage,
  drop column policy_description,
  drop column goal,
  drop column reason,
  drop column current_premium,
  drop column affordable_budget,
  drop column current_coverage,
  drop column coverage_needed,
  drop column notes;

-- 4. Ad funds ledger. Balance = sum of completed amount_cents.
-- Deposits are written by the Stripe webhook once Stripe is connected; ad spend by the Meta sync.
create table public.wallet_transactions (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.agents (id) on delete cascade,
  kind text not null check (kind in ('deposit', 'ad_spend', 'fee', 'refund', 'adjustment')),
  amount_cents int not null, -- positive adds to the balance, negative takes away
  status text not null default 'completed' check (status in ('pending', 'completed', 'failed')),
  description text,
  external_id text unique, -- Stripe payment intent / Meta billing id, for idempotent syncs
  created_at timestamptz not null default now()
);

create index wallet_transactions_agent_idx on public.wallet_transactions (agent_id, created_at desc);

-- 5. Creatives the agent wants used in their ads
create table public.creatives (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.agents (id) on delete cascade,
  kind text not null check (kind in ('image', 'video')),
  storage_path text not null unique,
  file_name text not null,
  mime_type text not null,
  size_bytes bigint not null,
  status text not null default 'submitted' check (status in ('submitted', 'in_review', 'live', 'rejected')),
  review_note text,
  created_at timestamptz not null default now()
);

create index creatives_agent_idx on public.creatives (agent_id, created_at desc);

-- 6. Testimonials shown on the agent's landing page
create table public.testimonials (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.agents (id) on delete cascade,
  author_name text not null check (char_length(author_name) between 1 and 80),
  author_detail text check (char_length(author_detail) <= 80),
  quote text not null check (char_length(quote) between 10 and 600),
  rating smallint check (rating between 1 and 5),
  published boolean not null default true,
  -- agents must confirm these are real clients' words shared with permission
  permission_confirmed boolean not null check (permission_confirmed),
  sort int not null default 0,
  created_at timestamptz not null default now()
);

create index testimonials_agent_idx on public.testimonials (agent_id, sort);

-- 7. Daily ad performance per agent (Meta Insights sync) and what the AI changed and why
create table public.ad_metrics_daily (
  agent_id uuid not null references public.agents (id) on delete cascade,
  date date not null,
  spend_cents int not null default 0,
  impressions int not null default 0,
  clicks int not null default 0,
  leads int not null default 0,
  primary key (agent_id, date)
);

create table public.ad_actions (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.agents (id) on delete cascade,
  kind text not null check (kind in ('launch', 'budget', 'creative', 'pause', 'audience', 'other')),
  title text not null,
  detail text,
  created_at timestamptz not null default now()
);

create index ad_actions_agent_idx on public.ad_actions (agent_id, created_at desc);

alter table public.intake_questions enable row level security;
alter table public.wallet_transactions enable row level security;
alter table public.creatives enable row level security;
alter table public.testimonials enable row level security;
alter table public.ad_metrics_daily enable row level security;
alter table public.ad_actions enable row level security;

-- 8. Storage: private bucket for ad creatives, public bucket for profile photos.
-- Creatives has no per-bucket size cap so the project's global upload limit applies (50 MB on the free plan).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('creatives', 'creatives', false, null,
    array['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/quicktime', 'video/webm']),
  ('agent-media', 'agent-media', true, 10485760,
    array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

notify pgrst, 'reload schema';

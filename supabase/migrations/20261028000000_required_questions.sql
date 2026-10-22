-- Required booking questions and per-focus campaigns.
-- 1. Agents can mark a question, or a whole step, as required: those are asked before the booking is
--    confirmed, and the booking is refused without them. Everything else stays optional after booking.
alter table public.intake_questions
  add column required boolean not null default false;

alter table public.agents
  add column required_intake_steps smallint[] not null default '{}';

-- 2. Each Migz campaign serves one of the agent's focus topics (null = made before campaigns had topics).
alter table public.ad_campaigns
  add column topic text;

notify pgrst, 'reload schema';

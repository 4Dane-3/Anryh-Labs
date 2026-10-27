-- One-week sprints and "Keep going".
--
-- 1. A batch can be a 7-day sprint (option 'sprint'): one campaign at a higher daily budget. Migz reads the
--    first collect_days, then revises. Other batches keep the 7-day collect window and their 14-day minimum.
-- 2. "Keep going": a batch marked renew starts the same plan again when it ends, paid from the agent's free
--    ad balance (never a card). renewed_from links each batch to the one it continues, and can only be used
--    once, so two callers can't both renew the same batch.
-- 3. renew_blocked: why the last attempt to renew didn't happen (balance too low, ads paused...), shown to the
--    agent and used to tell them once.

do $$
declare c text;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.campaign_batches'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%days >= 14%'
  loop
    execute format('alter table public.campaign_batches drop constraint %I', c);
  end loop;
end $$;

alter table public.campaign_batches
  add constraint campaign_batches_days_check check (days >= 7);

alter table public.campaign_batches drop constraint campaign_batches_option_check;
alter table public.campaign_batches
  add constraint campaign_batches_option_check check (option in ('focused', 'balanced', 'spread', 'explore', 'sprint'));

alter table public.campaign_batches
  add column collect_days int not null default 7 check (collect_days between 0 and 14),
  add column renew boolean not null default false,
  add column renewed_from uuid references public.campaign_batches (id) on delete set null,
  add column renew_blocked text;

create unique index campaign_batches_renewed_once on public.campaign_batches (renewed_from) where renewed_from is not null;

notify pgrst, 'reload schema';

-- Multi-step intake: split budget and coverage into current vs wanted, drop "best time to reach",
-- and track when the prospect finished the last step (answers are autosaved after each step).

alter table public.intake_responses rename column budget to current_premium;
alter table public.intake_responses rename column coverage_amount to current_coverage;

alter table public.intake_responses
  add column affordable_budget text,
  add column coverage_needed text,
  add column completed_at timestamptz;

alter table public.intake_responses drop column best_time_to_reach;

-- Rows saved before this change were single-page submissions, so they're complete
update public.intake_responses set completed_at = submitted_at where completed_at is null;

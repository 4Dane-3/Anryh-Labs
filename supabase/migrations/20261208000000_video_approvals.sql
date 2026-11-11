-- Video approvals: a video Migz makes for an ad set waits for the agent's OK before it goes to Meta.
-- Existing agents start with it off, so running campaigns don't change; new agents start with it on.

alter table public.agents add column if not exists video_approval boolean not null default false;
alter table public.agents alter column video_approval set default true;
alter table public.agents add column if not exists video_review_token text not null default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
create unique index if not exists agents_video_review_token_key on public.agents (video_review_token);

alter table public.creative_jobs drop constraint if exists creative_jobs_stage_check;
alter table public.creative_jobs add constraint creative_jobs_stage_check
  check (stage in ('generating', 'stored', 'awaiting_approval', 'meta_processing', 'launched', 'failed'));

alter table public.creative_jobs
  add column if not exists approval_status text check (approval_status in ('pending', 'approved', 'changes_requested')),
  add column if not exists approval_note text,
  add column if not exists approval_ready_at timestamptz,
  add column if not exists approval_requested_at timestamptz,
  add column if not exists approval_nudged_at timestamptz,
  add column if not exists approval_decided_at timestamptz;

create index if not exists creative_jobs_awaiting_approval_idx on public.creative_jobs (agent_id) where stage = 'awaiting_approval';

notify pgrst, 'reload schema';

-- Who appears in the roofer's on-camera videos, their brand for the edit, and the HyperFrames edit's progress.
-- Needs 20261209000000_roofer_autopilot.sql first.

-- The script introduces them by name and role; with no voice sample, the AI voice matches them
alter table public.agent_presenters
  add column if not exists on_camera_name text,
  add column if not exists on_camera_role text,
  add column if not exists on_camera_voice text not null default 'male' check (on_camera_voice in ('male', 'female'));

-- Their brand, for every edited video: colours and fonts scanned from their website, their logo, and the facts
-- they gave (only these ever appear on screen)
create table if not exists public.agent_brand (
  agent_id uuid primary key references public.agents (id) on delete cascade,
  website text,
  logo_path text,
  heading_font text,
  body_font text,
  background text,
  text_color text,
  accent text,
  font_note text,
  deals text[] not null default '{}',
  certifications text[] not null default '{}',
  license text,
  warranties text[] not null default '{}',
  scanned_at timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.agent_brand enable row level security;

-- The edit render on the worker: {status: rendering|done|failed, started_at, qc, error}
alter table public.creative_jobs add column if not exists edit_state jsonb;

notify pgrst, 'reload schema';

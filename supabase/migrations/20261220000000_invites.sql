-- Hair transplant clinics, and staff invites. Staff invite each client from the admin and choose their business
-- type there (roofing, hair transplant clinic or life insurance), so setup no longer asks it.

alter table public.agents drop constraint if exists agents_vertical_check;
alter table public.agents
  add constraint agents_vertical_check check (vertical in ('insurance', 'roofing', 'hair_clinic'));

alter table public.agents
  add column if not exists invited_at timestamptz, -- when staff invited them (null: made before invites)
  add column if not exists invited_by text;        -- the staff email that sent it

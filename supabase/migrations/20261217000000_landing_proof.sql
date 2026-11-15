-- Real proof shown on a roofer's landing pages: review score and count, other review badges, stats, the owner's
-- video, customer video testimonials and customer logos. Media are paths in the creatives bucket.
-- Empty by default: nothing is shown to visitors until it is filled in (staff see placeholders in preview).
alter table public.agent_brand add column if not exists proof jsonb not null default '{}'::jsonb;

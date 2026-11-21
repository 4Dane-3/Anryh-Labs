-- Roofers and clinics pay Meta for their ads directly: their card on their own Meta ad account, so every charge
-- shows in Meta's billing. Setup confirms the card is there before their campaign can start.
alter table public.agents
  add column if not exists meta_card_at timestamptz,
  add column if not exists meta_card_label text;

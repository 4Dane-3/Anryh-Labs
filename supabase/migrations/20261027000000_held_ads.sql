-- Ads built while MIGZ_TEST_MODE is on are created paused ("held") so you can preview the finished ad in
-- Meta Ads Manager without any chance of delivery. They switch on when test mode ends.
alter table public.ads
  add column held_by_test_mode boolean not null default false;

notify pgrst, 'reload schema';

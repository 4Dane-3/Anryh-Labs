-- How far apart bookable start times are, separate from how long a call is (slot_minutes). For
-- example 15-minute calls offered on the hour: 9:00, 10:00, 11:00. Null means the same as the call
-- length (the old behavior).
alter table public.agents add column slot_interval_minutes int
  check (slot_interval_minutes is null or slot_interval_minutes between 10 and 240);

notify pgrst, 'reload schema';

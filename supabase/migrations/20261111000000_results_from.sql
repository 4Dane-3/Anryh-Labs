-- When an agent's results stop being comparable (their ads moved off the Audience Network, which
-- restarts Meta's learning), Migz counts results only from this date: reviews judge ads on what came
-- after it, and the first-week "collecting results" rule (no pausing ads, moving budget or changing
-- placements) restarts from it. Null = count everything since the campaign started.
alter table public.agents add column results_from date;

notify pgrst, 'reload schema';

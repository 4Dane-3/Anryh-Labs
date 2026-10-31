-- The insurance companies an agent says they can sell from, shown on their booking page as "Partnered
-- Insurance Companies" and edited under My page. null = never set (the page falls back to the list its host
-- site keeps for them); an empty list = they chose to show none.
--
-- Run once in the Supabase SQL editor. Safe to run again.

alter table public.agents
  add column if not exists partner_carriers text[];

-- Miguel Cruz's page already showed these fifteen (kept in the Foreign Financial site until now)
update public.agents
set partner_carriers = array[
  'Mutual of Omaha', 'Foresters Financial', 'Transamerica', 'Corebridge Financial', 'Americo', 'Aetna',
  'SPLI Term', 'SPLI Life', 'Lafayette Life', 'United Home Life', 'Senior Life', 'Guaranteed Trust Life',
  'Ethos Life', 'American Income Life', 'Fidelity Life'
]
where slug = 'miguel-cruz' and partner_carriers is null;

notify pgrst, 'reload schema';

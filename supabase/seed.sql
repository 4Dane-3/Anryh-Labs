-- Demo agent for local testing. Replace the email and slack_user_id, or delete this agent before launch.
with demo as (
  insert into public.agents (
    slug, full_name, headline, bio, license_number, licensed_states,
    email, timezone, slack_user_id
  )
  values (
    'demo-agent',
    'Demo Agent',
    'Life insurance that fits your family and your budget',
    'I help families find the right coverage without the pressure. On our call we will talk through what you need, compare options from multiple carriers, and you decide.',
    'TX-0000000',
    '{TX,FL,GA}',
    'agent@example.com',
    'America/Chicago',
    null
  )
  on conflict (slug) do nothing
  returning id
)
insert into public.availability_rules (agent_id, weekday, start_time, end_time)
select demo.id, d.weekday, t.start_time, t.end_time
from demo
cross join (values (1), (2), (3), (4), (5)) as d (weekday)
cross join (values ('09:00'::time, '12:00'::time), ('13:00'::time, '17:00'::time)) as t (start_time, end_time);

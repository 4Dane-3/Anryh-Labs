-- Sample dashboard data for the demo agent only, so the dashboard has something to show before
-- Meta and Stripe are connected. Safe to re-run: it clears the demo agent's sample rows first.
-- Never run this for a real agent.

do $$
declare
  demo uuid := (select id from public.agents where slug = 'demo-agent');
begin
  if demo is null then
    raise exception 'demo-agent not found; run seed.sql first';
  end if;

  delete from public.ad_metrics_daily where agent_id = demo;
  delete from public.ad_actions where agent_id = demo;
  delete from public.wallet_transactions where agent_id = demo;
  delete from public.testimonials where agent_id = demo;

  -- 30 days of plausible numbers (deterministic so the charts look the same every run)
  insert into public.ad_metrics_daily (agent_id, date, spend_cents, impressions, clicks, leads)
  select
    demo,
    current_date - d,
    1800 + (d * 137) % 700,
    (1800 + (d * 137) % 700) + (d * 53) % 400 + 900,
    ((1800 + (d * 137) % 700) + (d * 53) % 400 + 900) * 14 / 1000 + d % 5,
    (((1800 + (d * 137) % 700) + (d * 53) % 400 + 900) * 14 / 1000 + d % 5) / 11
  from generate_series(1, 30) as d;

  insert into public.wallet_transactions (agent_id, kind, amount_cents, description, created_at)
  values
    (demo, 'deposit', 50000, 'Added funds', now() - interval '31 days'),
    (demo, 'deposit', 30000, 'Added funds', now() - interval '12 days');

  insert into public.wallet_transactions (agent_id, kind, amount_cents, description, created_at)
  select demo, 'ad_spend', -sum(spend_cents)::int,
    'Meta ad spend · week of ' || to_char(date_trunc('week', date), 'Mon DD'),
    least(date_trunc('week', date) + interval '6 days 23 hours', now()) -- never future-dated
  from public.ad_metrics_daily
  where agent_id = demo
  group by date_trunc('week', date);

  insert into public.ad_actions (agent_id, kind, title, detail, created_at)
  values
    (demo, 'launch', 'Launched "Protect your family" campaign',
      'Three video ads and two images, optimized for booked calls.', now() - interval '29 days'),
    (demo, 'creative', 'Paused image ad B',
      'Click-through rate was 0.41% after 2,100 impressions, a third of the other ads.', now() - interval '18 days'),
    (demo, 'budget', 'Moved $6/day to the mortgage-protection video',
      'It books calls at $21 each versus $38 for the rest of the campaign.', now() - interval '11 days'),
    (demo, 'creative', 'Launched two new hooks on the winning video',
      'Same body, new first three seconds: "Is your family covered if…" and "Your work policy ends when…".', now() - interval '6 days'),
    (demo, 'audience', 'Expanded placements to Reels',
      'Feed costs rose 18% this week; Reels was cheaper per click in the test.', now() - interval '3 days'),
    (demo, 'budget', 'Held budget steady',
      'The new hooks are still in Meta''s learning phase, so no changes until they have more data.', now() - interval '1 day');

  insert into public.testimonials (agent_id, author_name, author_detail, quote, rating, permission_confirmed, sort)
  values
    (demo, 'Sample client', 'Sample testimonial · Austin, TX',
      'I thought I was stuck with my old policy. We found the same coverage for almost $30 less a month.', 5, true, 0),
    (demo, 'Sample client', 'Sample testimonial · Tampa, FL',
      'No pressure at all. Everything was explained in plain English and I finally understand what we have.', 5, true, 1),
    (demo, 'Sample client', 'Sample testimonial · Atlanta, GA',
      'Quick call, clear options, and I had coverage in place the same week.', 5, true, 2);
end $$;

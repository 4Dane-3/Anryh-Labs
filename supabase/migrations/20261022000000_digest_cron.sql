-- Hourly trigger for the agent morning digest (/api/cron/digest), run by Supabase instead of Vercel
-- (Vercel's Hobby plan only allows daily cron jobs). The endpoint decides per agent whether it's their
-- digest hour yet, so it must be called hourly for every timezone to get its 8am summary.
--
-- BEFORE running this, store two secrets in Vault (once, in the SQL editor):
--   select vault.create_secret('https://your-production-domain.com', 'app_url');
--   select vault.create_secret('<same value as the CRON_SECRET env var>', 'cron_secret');
-- To change them later: select vault.update_secret(id, '<new value>') using the id from vault.secrets.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Scheduling by name replaces an existing job with the same name, so this is safe to re-run.
select cron.schedule(
  'agent-morning-digest',
  '0 * * * *',
  $$
  select net.http_get(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'app_url') || '/api/cron/digest',
    headers := jsonb_build_object(
      'Authorization',
      'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    timeout_milliseconds := 30000
  );
  $$
);

-- Check it's running:   select * from cron.job_run_details order by start_time desc limit 5;
-- See the responses:    select status_code, content from net._http_response order by created desc limit 5;
-- Stop it:              select cron.unschedule('agent-morning-digest');

-- Schedules for the Migz engine, alongside the digest job from 20261022000000_digest_cron.sql.
-- Uses the same Vault secrets (app_url, cron_secret) - create those first.
--   agent-migz-review:     hourly; the endpoint reviews each agent at most every 6 hours
--   agent-creative-jobs:   every 10 minutes; advances Higgsfield generations and Meta uploads

-- These are also created by the digest migration; repeating them lets this file run on its own.
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'agent-migz-review',
  '15 * * * *',
  $$
  select net.http_get(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'app_url') || '/api/cron/migz',
    headers := jsonb_build_object(
      'Authorization',
      'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    timeout_milliseconds := 300000
  );
  $$
);

select cron.schedule(
  'agent-creative-jobs',
  '*/10 * * * *',
  $$
  select net.http_get(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'app_url') || '/api/cron/creatives',
    headers := jsonb_build_object(
      'Authorization',
      'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    timeout_milliseconds := 300000
  );
  $$
);

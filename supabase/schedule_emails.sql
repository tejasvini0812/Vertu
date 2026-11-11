-- Run once, after deploying the send-emails function (see README, "Setting up email").
-- Calls the function every minute using pg_cron + pg_net. Replace the two values first.

create extension if not exists pg_net;
create extension if not exists pg_cron;

select vault.create_secret('https://YOUR-PROJECT-REF.supabase.co', 'vertu_project_url');
select vault.create_secret('THE-SAME-VALUE-AS-EMAIL_CRON_SECRET', 'vertu_email_cron_secret');

select cron.schedule('vertu-send-emails', '* * * * *', $$
  select net.http_post(
    url     := (select decrypted_secret from vault.decrypted_secrets where name = 'vertu_project_url') || '/functions/v1/send-emails',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'vertu_email_cron_secret')),
    body    := '{}'::jsonb,
    timeout_milliseconds := 20000)
$$);

-- and the hourly abandoned-bag check (if the migration couldn't schedule it):
select cron.schedule('vertu-abandoned-carts', '15 * * * *', 'select public.queue_abandoned_carts()');

-- Phase 7: rate limits for the public Edge Functions, error monitoring, a health check and alert emails.

-- ---------------------------------------------------------------- rate limits
-- Fixed-window counters keyed by "<function>:<ip>". Only the Edge Functions (service role) use them.
create table public.rate_limits (
  key          text primary key,
  window_start timestamptz not null default now(),
  hits         int not null default 0
);
alter table public.rate_limits enable row level security; -- no policies: invisible to browsers

create function public.hit_rate_limit(p_key text, p_max int, p_window_seconds int)
returns boolean
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  insert into rate_limits as r (key, window_start, hits) values (left(p_key, 200), now(), 1)
  on conflict (key) do update set
    hits = case when r.window_start < now() - make_interval(secs => p_window_seconds) then 1 else r.hits + 1 end,
    window_start = case when r.window_start < now() - make_interval(secs => p_window_seconds) then now() else r.window_start end
  returning hits into n;
  return n <= p_max;
end $$;

-- ---------------------------------------------------------------- monitoring
-- Browser errors, grouped: one row per distinct error, with a count.
create table public.client_errors (
  id          bigint generated always as identity primary key,
  fingerprint text not null unique,
  message     text not null,
  source      text not null default '',
  page        text not null default '',
  stack       text not null default '',
  user_agent  text not null default '',
  release     text not null default '',
  count       int  not null default 1,
  first_seen  timestamptz not null default now(),
  last_seen   timestamptz not null default now(),
  resolved    boolean not null default false
);
create index client_errors_seen_idx on public.client_errors (last_seen desc);
alter table public.client_errors enable row level security;
create policy "client errors admin read" on public.client_errors for select using (public.is_admin());
create policy "client errors admin update" on public.client_errors for update using (public.is_admin()) with check (public.is_admin());

-- Anyone can report a browser error. Text is trimmed, repeats only bump a counter, and at most 300
-- new distinct errors are kept per day, so this can't be used to fill the database.
create function public.log_client_error(p_message text, p_source text default '', p_page text default '',
  p_stack text default '', p_user_agent text default '', p_release text default '')
returns void
language plpgsql security definer set search_path = public as $$
declare
  msg text := left(coalesce(trim(p_message), ''), 500);
  src text := left(coalesce(p_source, ''), 300);
  fp  text;
begin
  if msg = '' then return; end if;
  fp := md5(msg || '|' || regexp_replace(src, ':\d+:\d+$', '') || '|' || coalesce(p_release, ''));
  update client_errors set count = count + 1, last_seen = now(), resolved = false,
    page = left(coalesce(p_page, ''), 300), user_agent = left(coalesce(p_user_agent, ''), 300)
    where fingerprint = fp;
  if found then return; end if;
  if (select count(*) from client_errors where first_seen > now() - interval '1 day') >= 300 then return; end if;
  insert into client_errors (fingerprint, message, source, page, stack, user_agent, release)
  values (fp, msg, src, left(coalesce(p_page, ''), 300), left(coalesce(p_stack, ''), 4000),
          left(coalesce(p_user_agent, ''), 300), left(coalesce(p_release, ''), 40))
  on conflict (fingerprint) do update set count = client_errors.count + 1, last_seen = now();
end $$;

-- Server-side events worth knowing about: Edge Function crashes and rate-limit trips.
create table public.ops_events (
  id      bigint generated always as identity primary key,
  at      timestamptz not null default now(),
  kind    text not null check (kind in ('function_error', 'rate_limited', 'alert')),
  source  text not null,
  message text not null default '',
  detail  jsonb not null default '{}'::jsonb
);
create index ops_events_at_idx on public.ops_events (at desc);
alter table public.ops_events enable row level security;
create policy "ops events admin read" on public.ops_events for select using (public.is_admin());

-- What the admin's System health screen shows.
create function public.system_health()
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r jsonb;
  cron_failures int := null;
begin
  if not public.is_admin() then raise exception 'not allowed' using errcode = '42501'; end if;
  if to_regclass('cron.job_run_details') is not null then
    execute $q$select count(*)::int from cron.job_run_details where status = 'failed' and start_time > now() - interval '1 day'$q$
      into cron_failures;
  end if;
  select jsonb_build_object(
    'checked_at', now(),
    'emails_failed', (select count(*) from email_outbox where status = 'failed'),
    'emails_waiting', (select count(*) from email_outbox where status = 'pending' and send_after < now() - interval '15 minutes'),
    'emails_sent_day', (select count(*) from email_outbox where status = 'sent' and sent_at > now() - interval '1 day'),
    'last_email_sent', (select max(sent_at) from email_outbox where status = 'sent'),
    'client_errors_day', (select coalesce(sum(count), 0) from client_errors where last_seen > now() - interval '1 day' and not resolved),
    'function_errors_day', (select count(*) from ops_events where kind = 'function_error' and at > now() - interval '1 day'),
    'rate_limited_day', (select count(*) from ops_events where kind = 'rate_limited' and at > now() - interval '1 day'),
    'unpaid_stuck', (select count(*) from orders where payment_status = 'awaiting' and created_at < now() - interval '2 hours'),
    'tickets_overdue', (select count(*) from support_tickets where status <> 'closed' and due_at < now()),
    'privacy_open', (select count(*) from data_requests where resolved_at is null),
    'cron_failures_day', cron_failures,
    'recent_function_errors', coalesce((select jsonb_agg(e) from (select at, source, message from ops_events
                      where kind = 'function_error' order by at desc limit 10) e), '[]'::jsonb)
  ) into r;
  return r;
end $$;

-- For the public uptime check: only "is the database answering, and are emails flowing?".
create function public.health_ping()
returns jsonb
language sql security definer set search_path = public as $$
  select jsonb_build_object(
    'db', true,
    'email_backlog', (select count(*) from email_outbox where status = 'pending' and send_after < now() - interval '15 minutes'),
    'emails_failed', (select count(*) from email_outbox where status = 'failed')
  )
$$;

-- Hourly: email the store about problems, at most once a day per kind of problem.
create function public.ops_check()
returns int
language plpgsql security definer set search_path = public as $$
declare
  s settings;
  issues text[] := '{}';
  n int;
  sent int := 0;
  issue text;
  key text;
begin
  select * into s from settings where id = 1;
  select count(*) into n from email_outbox where status = 'failed' and created_at > now() - interval '1 day';
  if n > 0 then issues := issues || format('emails:%s email%s failed to send in the last day. Open Emails in the admin to retry them.', n, case when n = 1 then '' else 's' end); end if;
  select count(*) into n from email_outbox where status = 'pending' and send_after < now() - interval '30 minutes';
  if n > 0 then issues := issues || format('backlog:%s email%s waiting more than 30 minutes. The email sender may be stopped (check the send-emails job and the RESEND_API_KEY secret).', n, case when n = 1 then ' is' else 's are' end); end if;
  select count(*) into n from ops_events where kind = 'function_error' and at > now() - interval '1 hour';
  if n >= 3 then issues := issues || format('functions:%s server errors in the last hour (checkout, payments, shipping or emails). See System health in the admin.', n); end if;
  select coalesce(sum(count), 0) into n from client_errors where last_seen > now() - interval '1 hour' and not resolved;
  if n >= 25 then issues := issues || format('browser:%s errors in shoppers’ browsers in the last hour. See System health in the admin.', n); end if;
  select count(*) into n from orders where payment_status = 'awaiting' and created_at < now() - interval '2 hours';
  if n > 0 then issues := issues || format('payments:%s online order%s still waiting for payment after 2 hours. Unpaid orders should expire and release their stock within the hour, so the expiry job may be stopped.', n, case when n = 1 then ' is' else 's are' end); end if;

  foreach issue in array issues loop
    key := 'admin_alert:' || split_part(issue, ':', 1) || ':' || to_char(now() at time zone 'Asia/Kolkata', 'YYYY-MM-DD');
    continue when exists (select 1 from email_outbox where dedupe_key = key); -- already alerted today
    perform enqueue_email('admin_alert', s.notify_email,
      jsonb_build_object('kind', split_part(issue, ':', 1), 'message', substr(issue, strpos(issue, ':') + 1)), key);
    insert into ops_events (kind, source, message) values ('alert', split_part(issue, ':', 1), substr(issue, strpos(issue, ':') + 1));
    sent := sent + 1;
  end loop;

  -- housekeeping
  delete from rate_limits where window_start < now() - interval '1 day';
  delete from ops_events where at < now() - interval '90 days';
  delete from client_errors where last_seen < now() - interval '90 days';
  return sent;
end $$;

revoke execute on function public.hit_rate_limit(text, int, int), public.health_ping(), public.ops_check()
  from public, anon, authenticated;
grant execute on function public.hit_rate_limit(text, int, int), public.health_ping(), public.ops_check() to service_role;
revoke execute on function public.system_health() from public, anon;
grant execute on function public.system_health() to authenticated;
revoke execute on function public.log_client_error(text, text, text, text, text, text) from public;
grant execute on function public.log_client_error(text, text, text, text, text, text) to anon, authenticated, service_role;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('vertu-ops-check', '5 * * * *', 'select public.ops_check()');
  end if;
exception when others then
  raise notice 'ops check job not scheduled: %', sqlerrm;
end $$;

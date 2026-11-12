// System health: is the store working? Emails, server errors, shoppers' browser errors, background jobs.
import { LIVE, supabase, describeError } from '../store.js';
import { esc, $, toast, enter, listen } from './ui.js';
import { fmtDateTime } from './overview.js';

const when = (t) => (t ? fmtDateTime(Date.parse(t)) : 'never');

export async function renderHealth(root) {
  const on = listen(root);
  root.innerHTML = `<header class="page-head"><div><h1>System health</h1>
    <p>Whether emails are going out, and any errors on the server or in shoppers’ browsers. The store also emails you when something needs a look, at most once a day per problem.</p></div>
    ${LIVE ? '<div class="page-head__actions"><button class="btn btn--ghost" data-refresh>Check again</button></div>' : ''}</header>
    ${LIVE ? '<p class="empty" data-loading>Checking…</p>' : '<p class="empty">System health appears once the store is connected to its database.</p>'}`;
  enter(root);
  if (!LIVE) return;
  const [{ data: h, error }, { data: errs }] = await Promise.all([
    supabase.rpc('system_health'),
    supabase.from('client_errors').select('*').eq('resolved', false).order('last_seen', { ascending: false }).limit(50),
  ]);
  if (!root.isConnected) return;
  if (error) return ($('[data-loading]', root).textContent = describeError(error));

  const checks = [
    ['Emails sending', !h.emails_waiting, h.emails_waiting ? `${h.emails_waiting} waiting more than 15 minutes. Check the send-emails job and the RESEND_API_KEY secret.` : `${h.emails_sent_day} sent in the last day. Last one: ${when(h.last_email_sent)}.`],
    ['No failed emails', !h.emails_failed, h.emails_failed ? `${h.emails_failed} failed. Retry them from an order, or check the email settings.` : 'Every email was delivered to the provider.'],
    ['Server running cleanly', h.function_errors_day < 3, `${h.function_errors_day} server error${h.function_errors_day === 1 ? '' : 's'} in the last day.`],
    ['Shoppers’ browsers', h.client_errors_day < 25, `${h.client_errors_day} error${h.client_errors_day === 1 ? '' : 's'} reported in the last day.`],
    ['Unpaid orders expiring', !h.unpaid_stuck, h.unpaid_stuck ? `${h.unpaid_stuck} order${h.unpaid_stuck === 1 ? ' has' : 's have'} waited over 2 hours for payment. The job that releases held stock may be stopped.` : 'Unpaid orders release their stock on time.'],
    ['Background jobs', h.cron_failures_day == null ? null : !h.cron_failures_day, h.cron_failures_day == null ? 'Couldn’t read the job history (pg_cron may be off).' : h.cron_failures_day ? `${h.cron_failures_day} job run${h.cron_failures_day === 1 ? '' : 's'} failed in the last day. See Database → Cron in Supabase.` : 'Every scheduled job ran in the last day.'],
    ['Complaints on time', !h.tickets_overdue, h.tickets_overdue ? `${h.tickets_overdue} complaint${h.tickets_overdue === 1 ? ' is' : 's are'} past the one-month deadline. See Support.` : 'No complaints past their deadline.'],
  ];
  $('[data-loading]', root).outerHTML = `
    <section class="block" aria-labelledby="h-now">
      <div class="block__intro"><h2 id="h-now">Right now</h2><p>Checked ${when(h.checked_at)}.${h.rate_limited_day ? ` ${h.rate_limited_day === 1 ? 'One burst' : `${h.rate_limited_day} bursts`} of requests from a single address ${h.rate_limited_day === 1 ? 'was' : 'were'} slowed down today.` : ''}</p></div>
      <div class="block__form"><ul class="checklist" data-checks>${checks
        .map(([label, ok, hint]) => `<li><span class="${ok ? 'ok' : 'no'}" aria-label="${ok ? 'Fine' : ok === null ? 'Unknown' : 'Needs a look'}">${ok ? '✓' : ok === null ? '?' : '!'}</span><span>${esc(label)}<small>${esc(hint)}</small></span></li>`)
        .join('')}</ul></div>
    </section>
    <section class="block" aria-labelledby="h-fn">
      <div class="block__intro"><h2 id="h-fn">Server errors</h2><p>The last ten crashes in checkout, payments, shipping or emails. The shopper saw a polite error; the details are in Supabase → Edge Functions → Logs.</p></div>
      <div class="block__form">${
        h.recent_function_errors.length
          ? `<div class="table-wrap"><table><thead><tr><th>When</th><th>Where</th><th>Error</th></tr></thead><tbody>${h.recent_function_errors
              .map((e) => `<tr><td class="muted">${when(e.at)}</td><td>${esc(e.source)}</td><td>${esc(e.message)}</td></tr>`)
              .join('')}</tbody></table></div>`
          : '<p class="muted">None recorded.</p>'
      }</div>
    </section>
    <section class="block" aria-labelledby="h-br">
      <div class="block__intro"><h2 id="h-br">Errors in shoppers’ browsers</h2><p>Grouped: each row is one problem, with how many times it happened. Mark one fixed after a new release; it reappears if it happens again.</p></div>
      <div class="block__form" data-errs>${
        errs?.length
          ? `<div class="table-wrap"><table><thead><tr><th>Error</th><th>Page</th><th>Times</th><th>Last seen</th><th></th></tr></thead><tbody>${errs
              .map((e) => `<tr data-id="${e.id}"><td><strong>${esc(e.message)}</strong>${e.source ? `<br><span class="muted" style="font-size:.8125rem">${esc(e.source)}</span>` : ''}${e.stack ? `<details><summary class="muted" style="font-size:.8125rem">Details</summary><pre class="msg" style="font-size:.75rem;overflow:auto">${esc(e.stack)}\n\n${esc(e.user_agent)}\nRelease ${esc(e.release)}</pre></details>` : ''}</td>
                <td>${esc(e.page)}</td><td class="num">${e.count}</td><td class="muted">${when(e.last_seen)}</td><td><button class="text-btn" data-fixed>Mark fixed</button></td></tr>`)
              .join('')}</tbody></table></div>`
          : '<p class="muted">None. Shoppers’ browsers aren’t reporting any problems.</p>'
      }</div>
    </section>`;
  on('click', async (e) => {
    if (e.target.closest('[data-refresh]')) return renderHealth(root);
    if (!e.target.closest('[data-fixed]')) return;
    const tr = e.target.closest('tr');
    const { error: err } = await supabase.from('client_errors').update({ resolved: true }).eq('id', Number(tr.dataset.id));
    if (err) return toast(describeError(err));
    tr.remove();
    toast('Marked fixed');
  });
}

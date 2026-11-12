import { LIVE, supabase, callFunction, describeError } from '../store.js';
import { session } from './auth.js';
import { esc, $, $$, toast, confirmDialog, openDrawer, closeDrawer, drawerEl, enter, listen } from './ui.js';
import { fmtDate, fmtDateTime } from './overview.js';

const CAT = { order: 'Order', delivery: 'Delivery', return: 'Return or refund', payment: 'Payment', cancel: 'Cancel an order', product: 'Product', privacy: 'Personal data', other: 'Other' };
let tab = 'open';

const daysLeft = (t) => Math.ceil((Date.parse(t.due_at) - Date.now()) / 86400000);

export async function renderSupport(root) {
  const on = listen(root);
  root.innerHTML = `<header class="page-head"><div><h1>Support</h1>
    <p>Messages and complaints from the contact form, and privacy requests. The rules require complaints to be acknowledged within 48 hours (that’s automatic) and resolved within a month.</p></div></header>
    ${LIVE ? '<p class="empty" data-loading>Loading…</p>' : '<p class="empty">Support tickets and privacy requests appear here once the store is connected to its database.</p>'}`;
  enter(root);
  if (!LIVE) return;
  const owner = session.role === 'owner';
  const [{ data: tickets, error }, { data: privacy }] = await Promise.all([
    supabase.from('support_tickets').select('*').order('created_at', { ascending: false }).limit(300),
    owner ? supabase.from('data_requests').select('*').order('created_at', { ascending: false }).limit(100) : Promise.resolve({ data: [] }),
  ]);
  if (!root.isConnected) return;
  if (error) return ($('[data-loading]', root).textContent = describeError(error));
  const open = tickets.filter((t) => t.status !== 'closed');
  const rows = tab === 'open' ? open : tickets;
  const pendingPrivacy = (privacy || []).filter((r) => !r.resolved_at);
  $('[data-loading]', root).outerHTML = `
    <div class="toolbar"><div class="tabs" role="tablist">
      <button role="tab" data-t="open" aria-selected="${tab === 'open'}">Open<sup>${open.length}</sup></button>
      <button role="tab" data-t="all" aria-selected="${tab === 'all'}">All<sup>${tickets.length}</sup></button></div></div>
    <div class="table-wrap"><table><thead><tr><th>Ticket</th><th>From</th><th>About</th><th>Received</th><th>Resolve by</th><th>State</th></tr></thead><tbody>${
      rows.length
        ? rows
            .map((t) => {
              const left = daysLeft(t);
              return `<tr data-id="${t.id}" class="clickable"><td><button class="text-btn order-id" data-open>${esc(t.number)}</button></td>
            <td>${esc(t.name)}<br><span class="muted" style="font-size:.8125rem">${esc(t.email)}</span></td>
            <td>${esc(CAT[t.category] || t.category)}${t.order_id ? `<br><span class="muted" style="font-size:.8125rem">${esc(t.order_id)}</span>` : ''}</td>
            <td class="muted">${fmtDate(Date.parse(t.created_at))}</td>
            <td>${t.status === 'closed' ? '<span class="muted">Resolved</span>' : left < 0 ? `<span class="pill pill--ink">${-left} days late</span>` : left <= 5 ? `<span class="pill pill--line">${left} days left</span>` : `<span class="muted">${fmtDate(Date.parse(t.due_at))}</span>`}</td>
            <td><span class="pay ${t.status === 'open' ? 'pay-wait' : t.status === 'answered' ? 'pay-due' : 'pay-ok'}">${{ open: 'Waiting for us', answered: 'Answered', closed: 'Resolved' }[t.status]}</span></td></tr>`;
            })
            .join('')
        : `<tr><td colspan="6"><p class="empty">${tab === 'open' ? 'Nothing waiting. ' : ''}No tickets${tab === 'open' ? ' open' : ''}.</p></td></tr>`
    }</tbody></table></div>
    ${
      owner
        ? `<section style="margin-top:56px"><div class="panel__head"><h2 style="font-size:1.625rem;font-style:italic">Privacy requests</h2><span class="muted">${pendingPrivacy.length} waiting</span></div>
      <div class="table-wrap"><table><thead><tr><th>Asked</th><th>Who</th><th>Wants</th><th>State</th><th class="r"></th></tr></thead><tbody>${
        (privacy || []).length
          ? privacy
              .map(
                (r) => `<tr data-pr="${r.id}"><td class="muted">${fmtDate(Date.parse(r.created_at))}</td><td>${esc(r.email)}</td><td>${r.kind === 'delete' ? 'Delete account' : 'Copy of their data'}</td>
          <td>${r.resolved_at ? `<span class="muted">Done ${fmtDate(Date.parse(r.resolved_at))}</span>` : '<span class="pay pay-wait">Waiting</span>'}</td>
          <td><div class="row-btns" style="justify-content:flex-end">${r.resolved_at ? '' : `${r.user_id ? `<button class="btn btn--ghost" data-pact="export">Download data</button>${r.kind === 'delete' ? '<button class="btn btn--ghost" data-pact="erase">Erase account</button>' : ''}` : ''}<button class="btn btn--ghost" data-pact="done">Mark done</button>`}</div></td></tr>`,
              )
              .join('')
          : '<tr><td colspan="5"><p class="empty">No privacy requests.</p></td></tr>'
      }</tbody></table></div>
      <p class="muted" style="margin-top:10px">“Download data” gives you a file to email to the person. “Erase account” deletes their account, addresses, wishlist, bag and newsletter record; orders and invoices stay for tax law but are detached.</p></section>`
        : ''
    }`;

  $$('[data-t]', root).forEach((b) => b.addEventListener('click', () => ((tab = b.dataset.t), renderSupport(root))));
  on('click', async (e) => {
    const tr = e.target.closest('tr[data-id]');
    if (tr) return openTicket(tickets.find((t) => t.id === Number(tr.dataset.id)), () => renderSupport(root));
    const pb = e.target.closest('[data-pact]');
    if (!pb) return;
    const r = privacy.find((x) => x.id === Number(pb.closest('tr').dataset.pr));
    const act = pb.dataset.pact;
    if (act === 'export') {
      const x = await callFunction('admin-privacy', { request_id: r.id, action: 'export' });
      if (!x.ok) return toast(x.body.error === 'no_account' ? 'That account no longer exists.' : `Couldn’t export: ${x.body.error}`);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([JSON.stringify(x.body.data, null, 2)], { type: 'application/json' }));
      a.download = `vertu-data-${r.email.replace(/[^a-z0-9]/gi, '-')}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
      return toast('Downloaded. Email it to the person, then mark the request done.');
    }
    if (act === 'erase') {
      if (!(await confirmDialog({ title: `Erase ${r.email}?`, body: 'Their account and personal details are deleted for good. Orders and invoices are kept for tax law, without the link to the account. This can’t be undone.', ok: 'Erase account' }))) return;
      const x = await callFunction('admin-privacy', { request_id: r.id, action: 'erase' });
      if (!x.ok) return toast(`Couldn’t erase: ${x.body.message || x.body.error}`);
      await supabase.rpc('resolve_data_request', { p_id: r.id, p_note: 'Your account and personal details have been deleted. Order and invoice records are kept as tax law requires, no longer linked to an account.' });
      toast('Erased, and the person has been emailed.');
      return renderSupport(root);
    }
    if (act === 'done') {
      const { error: x } = await supabase.rpc('resolve_data_request', { p_id: r.id, p_note: r.kind === 'export' ? 'We’ve sent you a copy of your data.' : 'Your request has been completed.' });
      if (x) return toast(describeError(x));
      toast('Marked done, and the person has been emailed.');
      renderSupport(root);
    }
  });
}

function openTicket(t, done) {
  const body = `
    <dl style="margin:0">
      <div class="kv"><dt>From</dt><dd>${esc(t.name)}<br><a class="text-btn" href="mailto:${esc(t.email)}?subject=${encodeURIComponent(`Re: your message (${t.number})`)}">${esc(t.email)}</a>${t.phone ? `<br>${esc(t.phone)}` : ''}</dd></div>
      <div class="kv"><dt>About</dt><dd>${esc(CAT[t.category] || t.category)}${t.order_id ? `, <a class="text-btn" href="#/orders?open=${encodeURIComponent(t.order_id)}">${esc(t.order_id)}</a>` : ''}</dd></div>
      <div class="kv"><dt>Resolve by</dt><dd>${fmtDate(Date.parse(t.due_at))}${t.status !== 'closed' && daysLeft(t) < 0 ? ' <span class="pill pill--ink">Late</span>' : ''}</dd></div>
    </dl>
    <div><p class="label" style="font-weight:500;margin-bottom:6px">Message</p><p class="msg">${esc(t.message)}</p></div>
    ${t.last_reply ? `<div><p class="label" style="font-weight:500;margin-bottom:6px">Last reply, ${fmtDateTime(Date.parse(t.last_reply_at))}</p><p class="msg">${esc(t.last_reply)}</p></div>` : ''}
    <form id="tform" class="field" style="gap:14px" novalidate data-status="${t.status}">
      <div class="field"><label for="tk-reply">Reply (emailed to ${esc(t.email)})</label><textarea id="tk-reply" class="textarea" style="min-height:150px" maxlength="4000"></textarea></div>
      <div class="field" style="max-width:240px"><label for="tk-status">Then mark it</label><select id="tk-status" class="select">
        ${[['open', 'Still open'], ['answered', 'Answered, waiting on them'], ['closed', 'Resolved']].map(([v, l]) => `<option value="${v}" ${t.status === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <p class="err" data-err role="alert"></p>
    </form>`;
  openDrawer({ title: t.number, sub: `Received ${fmtDateTime(Date.parse(t.created_at))}`, body, foot: '<button class="btn btn--ghost" data-drawer-close type="button">Close</button><button class="btn btn--ink" type="submit" form="tform">Save</button>' });
  $('#tform', drawerEl).addEventListener('submit', async (e) => {
    e.preventDefault();
    const reply = $('#tk-reply', drawerEl).value.trim();
    const status = $('#tk-status', drawerEl).value;
    if (!reply && status === t.status) return ($('[data-err]', drawerEl).textContent = 'Write a reply or change the state.');
    if (!reply && status === 'answered') return ($('[data-err]', drawerEl).textContent = 'Write the reply before marking it answered.');
    const { data, error } = await supabase.rpc('reply_ticket', { p_id: t.id, p_reply: reply, p_status: status });
    if (error || !data?.ok) return ($('[data-err]', drawerEl).textContent = describeError(error || { message: data?.error }));
    toast(reply ? 'Reply sent' : 'Saved');
    closeDrawer();
    done();
  });
}

import { getState, LIVE, supabase, callFunction, refresh, describeError, money } from '../store.js';
import { session } from './auth.js';
import { esc, $, $$, toast, confirmDialog, openDrawer, drawerEl, enter, listen } from './ui.js';
import { fmtDate, fmtDateTime } from './overview.js';

const REASON = { damaged: 'Damaged', wrong_item: 'Wrong item', not_as_described: 'Not as described', changed_mind: 'Changed their mind', other: 'Other' };
const STATUS = {
  requested: ['Needs a decision', 'pay-wait'], approved: ['Approved', 'pay-due'], rejected: ['Not accepted', 'pay-off'],
  pickup_scheduled: ['Pickup booked', 'pay-due'], in_transit: ['Coming back', 'pay-due'], arrived: ['Arrived', 'pay-due'],
  received: ['Checked in, refund due', 'pay-wait'], refunded: ['Refunded', 'pay-ok'], closed: ['Closed', 'pay-off'],
};
let filter = 'open';
const OPEN = ['requested', 'approved', 'pickup_scheduled', 'in_transit', 'arrived', 'received'];

export async function renderReturns(root) {
  const on = listen(root);
  root.innerHTML = `<header class="page-head"><div><h1>Returns</h1>
    <p>Customers ask from their order page within the return window. Approve, book the pickup, check the bag in when it arrives, then refund.</p></div></header>
    ${LIVE ? '<p class="empty">Loading…</p>' : '<p class="empty">Returns need the store to be connected to its database. Customers request them from their order page.</p>'}`;
  enter(root);
  if (!LIVE) return;
  const { data, error } = await supabase
    .from('return_requests')
    .select('*, orders(id, customer_name, customer_email, ship_city, total, refunded_amount, payment_method, payment_status, razorpay_payment_id, delivered_at)')
    .order('id', { ascending: false })
    .limit(200);
  if (!root.isConnected) return;
  if (error) return ($('.empty', root).textContent = describeError(error));
  const rows = data.filter((r) => (filter === 'open' ? OPEN.includes(r.status) : true));
  const counts = { open: data.filter((r) => OPEN.includes(r.status)).length, all: data.length };
  $('.empty', root).outerHTML = `
    <div class="toolbar"><div class="tabs" role="tablist" aria-label="Returns">
      <button role="tab" data-f="open" aria-selected="${filter === 'open'}">Open<sup>${counts.open}</sup></button>
      <button role="tab" data-f="all" aria-selected="${filter === 'all'}">All<sup>${counts.all}</sup></button></div></div>
    <div class="table-wrap"><table><thead><tr><th>Return</th><th>Order</th><th>Customer</th><th>Reason</th><th>Items</th><th>State</th></tr></thead>
    <tbody>${
      rows.length
        ? rows
            .map((r) => {
              const [label, cls] = STATUS[r.status] || [r.status, ''];
              return `<tr data-id="${r.id}" class="clickable"><td><button class="text-btn order-id" data-open>#${r.id}</button><br><span class="muted" style="font-size:.8125rem">${fmtDate(Date.parse(r.created_at))}</span></td>
              <td>${esc(r.order_id)}</td><td>${esc(r.orders?.customer_name || '')}<br><span class="muted" style="font-size:.8125rem">${esc(r.orders?.ship_city || '')}</span></td>
              <td>${esc(REASON[r.reason] || r.reason)}</td><td class="num">${r.items.reduce((n, i) => n + i.qty, 0)}</td><td><span class="pay ${cls}">${label}</span></td></tr>`;
            })
            .join('')
        : `<tr><td colspan="6"><p class="empty">${filter === 'open' ? 'No open returns.' : 'No returns yet.'}</p></td></tr>`
    }</tbody></table></div>`;
  $$('[data-f]', root).forEach((b) => b.addEventListener('click', () => ((filter = b.dataset.f), renderReturns(root))));
  on('click', (e) => {
    const tr = e.target.closest('tr[data-id]');
    if (tr) openReturn(data.find((r) => r.id === Number(tr.dataset.id)), () => renderReturns(root));
  });
}

function openReturn(r, done) {
  const o = r.orders || {};
  const products = getState().products;
  const name = (sku) => {
    const p = products.find((x) => x.id === sku);
    return p ? `${p.colour} ${getState().categories.find((c) => c.id === p.category)?.unit || ''}` : sku;
  };
  const owner = session.role === 'owner';
  const online = o.payment_method === 'razorpay' && o.razorpay_payment_id;
  const [label] = STATUS[r.status] || [r.status];
  const body = `
    <dl style="margin:0">
      <div class="kv"><dt>State</dt><dd>${esc(label)}</dd></div>
      <div class="kv"><dt>Order</dt><dd><a class="text-btn" href="#/orders?open=${encodeURIComponent(r.order_id)}">${esc(r.order_id)}</a>, ${money(o.total || 0)}${o.delivered_at ? `, delivered ${fmtDate(Date.parse(o.delivered_at))}` : ''}</dd></div>
      <div class="kv"><dt>Customer</dt><dd>${esc(o.customer_name || '')}<br><a class="text-btn" href="mailto:${esc(o.customer_email || '')}">${esc(o.customer_email || '')}</a></dd></div>
      <div class="kv"><dt>Reason</dt><dd>${esc(REASON[r.reason] || r.reason)}${r.details ? `<br>“${esc(r.details)}”` : ''}</dd></div>
      <div class="kv"><dt>Returning</dt><dd>${r.items.map((i) => `${i.qty} × ${esc(name(i.sku))}`).join('<br>')}</dd></div>
      ${r.return_awb ? `<div class="kv"><dt>Return pickup</dt><dd>AWB <code>${esc(r.return_awb)}</code></dd></div>` : ''}
      ${r.admin_note ? `<div class="kv"><dt>Note to customer</dt><dd>${esc(r.admin_note)}</dd></div>` : ''}
      ${r.refund_amount != null ? `<div class="kv"><dt>Suggested refund</dt><dd>${money(r.refund_amount)} <span class="muted">(item prices less the order’s discount share)</span></dd></div>` : ''}
    </dl>
    ${
      r.status === 'requested'
        ? `<div class="field"><label for="rr-note">Message to the customer</label><textarea id="rr-note" class="textarea" maxlength="500" placeholder="e.g. Sorry about that. A courier will collect it within two days."></textarea></div>
           <div class="row-btns"><button class="btn btn--ink" data-act="approve">Approve</button><button class="btn btn--ghost" data-act="reject">Don’t accept</button></div>`
        : ''
    }
    ${r.status === 'approved' ? '<div class="row-btns"><button class="btn btn--ink" data-act="pickup">Book return pickup</button><button class="btn btn--ghost" data-act="receive">It arrived (no pickup needed)</button></div>' : ''}
    ${['pickup_scheduled', 'in_transit', 'arrived'].includes(r.status) ? '<div class="row-btns"><button class="btn btn--ink" data-act="receive">Check in and restock</button></div>' : ''}
    ${
      r.status === 'received'
        ? owner
          ? `<div class="row-btns">${online ? `<button class="btn btn--ink" data-act="refund">Refund ${money(r.refund_amount || 0)}</button>` : ''}<button class="btn btn--ghost" data-act="${online ? 'close' : 'close-refunded'}">${online ? 'Close without refund' : 'Refunded by bank transfer'}</button></div>
             ${online ? '' : '<p class="muted">This was a cash order: refund to the customer’s bank account, then mark it here.</p>'}`
          : '<p class="muted">An owner issues the refund.</p>'
        : ''
    }
    <p class="err" data-err role="alert"></p>`;
  openDrawer({ title: `Return #${r.id}`, sub: `Requested ${fmtDateTime(Date.parse(r.created_at))}`, body, foot: '' });
  const err = $('[data-err]', drawerEl);
  const after = async (msg) => {
    toast(msg);
    await refresh();
    done();
    const { data } = await supabase.from('return_requests').select('*, orders(id, customer_name, customer_email, ship_city, total, refunded_amount, payment_method, payment_status, razorpay_payment_id, delivered_at)').eq('id', r.id).single();
    if (data) openReturn(data, done);
  };
  drawerEl.querySelectorAll('[data-act]').forEach((b) =>
    b.addEventListener('click', async () => {
      err.textContent = '';
      const act = b.dataset.act;
      b.disabled = true;
      try {
        if (act === 'approve' || act === 'reject') {
          const { data, error } = await supabase.rpc('decide_return', { p_id: r.id, p_approve: act === 'approve', p_note: $('#rr-note', drawerEl).value.trim() });
          if (error || !data?.ok) throw error || new Error(data?.error);
          return after(act === 'approve' ? 'Approved. The customer has been emailed.' : 'Declined. The customer has been emailed.');
        }
        if (act === 'pickup') {
          const x = await callFunction('admin-shipping', { action: 'return_pickup', return_id: r.id });
          if (!x.ok) throw new Error({ shiprocket_not_configured: 'Shiprocket isn’t connected yet.', pickup_address_missing: 'Add your business address and pickup PIN in Settings first.' }[x.body.error] || x.body.message || x.body.error);
          return after(`Pickup booked with ${x.body.courier}`);
        }
        if (act === 'receive') {
          const { data, error } = await supabase.rpc('receive_return', { p_id: r.id });
          if (error || !data?.ok) throw error || new Error(data?.error);
          return after(`Checked in and restocked. Suggested refund ${money(data.refund_amount)}.`);
        }
        if (act === 'refund') {
          if (!(await confirmDialog({ title: `Refund ${money(r.refund_amount)}?`, body: 'It goes back to the customer’s original payment method. This can’t be undone.', ok: 'Refund' }))) return;
          const x = await callFunction('admin-order', { order_id: r.order_id, action: 'refund', amount: r.refund_amount, restock: false, reason: `Return #${r.id}` });
          if (!x.ok) throw new Error(x.body.error === 'bad_amount' ? 'That’s more than is left to refund on this order.' : x.body.error);
          await supabase.rpc('close_return', { p_id: r.id, p_refunded: true });
          return after(`${money(r.refund_amount)} refunded`);
        }
        if (act === 'close' || act === 'close-refunded') {
          await supabase.rpc('close_return', { p_id: r.id, p_refunded: act === 'close-refunded' });
          return after('Return closed');
        }
      } catch (e) {
        err.textContent = describeError(e);
      } finally {
        b.disabled = false;
      }
    }),
  );
}

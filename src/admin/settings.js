import { getState, update, describeError, LIVE, supabase } from '../store.js';
import { session, signOut } from './auth.js';
import { esc, $, toast, confirmDialog, enter, listen } from './ui.js';
import { MAIL_LABEL, MAIL_STATUS } from './orders.js';
import { INDIAN_STATES as STATES } from '../delivery.js';

const ENTITY = { products: 'Product', orders: 'Order', site_content: 'Editorial', settings: 'Settings', admin_users: 'Team', coupons: 'Discount', categories: 'Collection' };
const when = (t) => new Date(t).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

function describe(a) {
  const c = a.changes || {};
  const keys = Object.keys(c);
  if (a.entity === 'products' && a.action === 'update') {
    return keys
      .map((k) => (c[k] && typeof c[k] === 'object' && 'to' in c[k] ? `${k} ${c[k].from} → ${c[k].to}` : `${k} changed`))
      .join(', ');
  }
  if (a.entity === 'orders') return c.status ? `status ${c.status.from} → ${c.status.to}` : keys.join(', ');
  if (a.entity === 'site_content') return 'published editorial changes';
  if (a.entity === 'admin_users') return a.action === 'delete' ? 'removed a team member' : `role: ${c.role?.to || c.role || ''}`;
  return a.action === 'insert' ? 'created' : a.action === 'delete' ? 'deleted' : keys.join(', ');
}

export async function renderSettings(root) {
  const on = listen(root);
  const owner = session.role === 'owner';
  const s = getState();
  root.innerHTML = `
    <header class="page-head"><div><h1>Settings</h1>
      <p>${owner ? 'Your account, the team who can use the store manager, and a record of recent changes.' : 'Your account and store preferences.'}</p></div></header>

    <section class="block" aria-labelledby="s-acc">
      <div class="block__intro"><h2 id="s-acc">Your account</h2><p>${LIVE ? 'Signed in with two-step verification.' : 'Sample mode. No accounts until the database is connected.'}</p></div>
      <div class="block__form">
        ${
          LIVE
            ? `<dl style="margin:0"><div class="kv"><dt>Email</dt><dd>${esc(session.email)}</dd></div>
               <div class="kv"><dt>Role</dt><dd>${owner ? 'Owner: everything, including the team and removing products' : 'Staff: products, stock, orders and editorial'}</dd></div></dl>
               <div><button class="btn btn--ghost" data-signout>Sign out</button></div>`
            : '<p class="muted">Add your Supabase keys to switch to live data. The README explains how.</p>'
        }
      </div>
    </section>

    <section class="block" aria-labelledby="s-stock">
      <div class="block__intro"><h2 id="s-stock">Low-stock alert</h2><p>Colours at or below this number are flagged on the overview and in products.</p></div>
      <div class="block__form">
        <form class="inline-form" data-stock-form style="grid-template-columns:160px max-content">
          <div class="field"><label for="s-low">Alert at</label><input id="s-low" class="input" type="number" min="0" max="999" value="${s.settings.lowStock}" ${owner ? '' : 'disabled'} /></div>
          ${owner ? '<button class="btn btn--ink" type="submit">Save</button>' : '<p class="muted" style="align-self:center">Only an owner can change this.</p>'}
        </form>
      </div>
    </section>

    <section class="block" aria-labelledby="s-ship">
      <div class="block__intro"><h2 id="s-ship">Shipping and payment</h2><p>Charged at checkout. Prices already include GST.</p></div>
      <div class="block__form">
        <form data-ship-form novalidate style="display:grid;gap:18px">
          <div class="row2">
            <div class="field"><label for="sh-fee">Shipping fee (₹)</label><input id="sh-fee" class="input" type="number" min="0" value="${s.settings.shippingFee}" ${owner ? '' : 'disabled'} /><small>0 means shipping is free.</small></div>
            <div class="field"><label for="sh-free">Free shipping from (₹)</label><input id="sh-free" class="input" type="number" min="0" value="${s.settings.freeShippingOver}" ${owner ? '' : 'disabled'} /><small>Order value after discounts. 0 for no threshold.</small></div>
          </div>
          <label class="switch"><input type="checkbox" id="sh-cod" ${s.settings.codEnabled ? 'checked' : ''} ${owner ? '' : 'disabled'}><i></i>Offer cash on delivery</label>
          <div class="row2">
            <div class="field"><label for="sh-codfee">Cash on delivery fee (₹)</label><input id="sh-codfee" class="input" type="number" min="0" value="${s.settings.codFee}" ${owner ? '' : 'disabled'} /></div>
            <div class="field"><label for="sh-codmax">Cash on delivery up to (₹)</label><input id="sh-codmax" class="input" type="number" min="0" value="${s.settings.codMax}" ${owner ? '' : 'disabled'} /><small>Larger orders must pay online.</small></div>
          </div>
          <div class="row2">
            <div class="field"><label for="sh-loc">Shiprocket pickup location</label><input id="sh-loc" class="input" maxlength="60" value="${esc(s.settings.pickupLocation)}" ${owner ? '' : 'disabled'} /><small>Exactly as named in Shiprocket → Settings → Pickup addresses.</small></div>
            <div class="field"><label for="sh-pin">Pickup PIN code</label><input id="sh-pin" class="input" inputmode="numeric" maxlength="6" value="${esc(s.settings.pickupPin)}" ${owner ? '' : 'disabled'} /><small>Where couriers collect from (also used for delivery estimates).</small></div>
          </div>
          <div class="field" style="max-width:260px"><label for="sh-ret">Return window (days after delivery)</label><input id="sh-ret" class="input" type="number" min="0" max="60" value="${s.settings.returnWindowDays}" ${owner ? '' : 'disabled'} /><small>0 turns returns off. Match your returns policy.</small></div>
          <div class="field" style="max-width:260px"><label for="sh-hold">Hold unpaid items for (minutes)</label><input id="sh-hold" class="input" type="number" min="5" max="120" value="${s.settings.holdMinutes}" ${owner ? '' : 'disabled'} /><small>While a shopper pays online.</small></div>
          ${owner ? '<div><button class="btn btn--ink" type="submit">Save shipping and payment</button></div>' : '<p class="muted">Only an owner can change these.</p>'}
        </form>
      </div>
    </section>

    <section class="block" aria-labelledby="s-biz">
      <div class="block__intro"><h2 id="s-biz">Business and invoices</h2><p>Printed on invoices and used as the return address. Check the GST details with your accountant.</p></div>
      <div class="block__form">
        <form data-biz-form novalidate style="display:grid;gap:18px">
          <div class="field"><label for="b-name">Legal business name</label><input id="b-name" class="input" maxlength="120" value="${esc(s.settings.legalName)}" ${owner ? '' : 'disabled'} /></div>
          <div class="field"><label for="b-addr">Address</label><input id="b-addr" class="input" maxlength="300" value="${esc(s.settings.businessAddress)}" placeholder="Building, street, area" ${owner ? '' : 'disabled'} /></div>
          <div class="row2">
            <div class="field"><label for="b-city">City</label><input id="b-city" class="input" maxlength="80" value="${esc(s.settings.businessCity)}" ${owner ? '' : 'disabled'} /></div>
            <div class="field"><label for="b-state">State</label><select id="b-state" class="select" ${owner ? '' : 'disabled'}><option value="">Choose…</option>${STATES.map((x) => `<option ${x === s.settings.businessState ? 'selected' : ''}>${x}</option>`).join('')}</select><small>Decides CGST + SGST (same state) or IGST.</small></div>
          </div>
          <div class="row2">
            <div class="field"><label for="b-phone">Phone (+91)</label><input id="b-phone" class="input" inputmode="numeric" maxlength="10" value="${esc((s.settings.businessPhone || '').replace(/^\+91/, ''))}" ${owner ? '' : 'disabled'} /></div>
            <div class="field"><label for="b-prefix">Invoice prefix</label><input id="b-prefix" class="input" maxlength="6" value="${esc(s.settings.invoicePrefix)}" style="text-transform:uppercase" ${owner ? '' : 'disabled'} /><small>Numbers look like ${esc(s.settings.invoicePrefix || 'VRT')}/26-27/0001 and restart each April.</small></div>
          </div>
          <label class="switch"><input type="checkbox" id="b-reg" ${s.settings.gstRegistered ? 'checked' : ''} ${owner ? '' : 'disabled'}><i></i>Registered under GST</label>
          <div class="field" style="max-width:320px"><label for="b-gstin">GSTIN</label><input id="b-gstin" class="input" maxlength="15" value="${esc(s.settings.gstin)}" style="text-transform:uppercase" placeholder="27ABCDE1234F1Z5" ${owner ? '' : 'disabled'} /></div>
          ${owner ? '<div><button class="btn btn--ink" type="submit">Save business details</button></div>' : ''}
        </form>
      </div>
    </section>

    <section class="block" aria-labelledby="s-mail">
      <div class="block__intro"><h2 id="s-mail">Notifications</h2><p>Customers get emails about their orders automatically. Choose where the store’s own alerts go.</p></div>
      <div class="block__form">
        <form data-notify-form novalidate style="display:grid;gap:18px">
          <div class="field" style="max-width:420px"><label for="n-email">Send store alerts to</label><input id="n-email" class="input" type="email" value="${esc(s.settings.notifyEmail || '')}" placeholder="orders@yourdomain.com" ${owner ? '' : 'disabled'} />
            <small>New orders, orders that need a look, and colours running low. Leave empty for none.</small></div>
          <label class="switch"><input type="checkbox" id="n-cart" ${s.settings.abandonedCartEnabled ? 'checked' : ''} ${owner ? '' : 'disabled'}><i></i>Remind shoppers about a bag they left</label>
          <small class="muted" style="margin-top:-8px">One email, 3 hours after a signed-in shopper’s bag stops changing. Only to people who agreed to marketing emails.</small>
          ${owner ? '<div><button class="btn btn--ink" type="submit">Save notifications</button></div>' : ''}
        </form>
        ${LIVE ? '<div><p class="label" style="font-weight:500;margin:10px 0 6px">Recent emails</p><ul class="history" data-outbox><li class="muted">Loading…</li></ul></div>' : '<p class="muted">Emails are sent once the store is connected to its database and an email service.</p>'}
      </div>
    </section>

    ${
      owner && LIVE
        ? `<section class="block" aria-labelledby="s-news">
      <div class="block__intro"><h2 id="s-news">Newsletter</h2><p>People who confirmed their email from the footer sign-up, or ticked the box in their account.</p></div>
      <div class="block__form"><p data-subs class="muted">Loading…</p><div><button class="btn btn--ghost" data-csv type="button">Download subscribers (CSV)</button></div></div>
    </section>` : ''
    }

    ${
      owner && LIVE
        ? `<section class="block" aria-labelledby="s-team">
      <div class="block__intro"><h2 id="s-team">Team</h2><p>People who can sign in here. They need an account first: create one in Supabase under Authentication, then add their email.</p></div>
      <div class="block__form">
        <div class="list" data-team><p class="empty">Loading…</p></div>
        <form class="inline-form" data-add-form novalidate>
          <div class="field"><label for="t-email">Email</label><input id="t-email" class="input" type="email" autocomplete="off" required /></div>
          <div class="field"><label for="t-role">Role</label><select id="t-role" class="select"><option value="staff">Staff</option><option value="owner">Owner</option></select></div>
          <button class="btn btn--ink" type="submit">Add</button>
        </form>
        <p class="err" data-team-err role="alert"></p>
      </div>
    </section>
    <section class="block" aria-labelledby="s-act">
      <div class="block__intro"><h2 id="s-act">Recent activity</h2><p>Every change to products, orders, editorial and the team, with who made it.</p></div>
      <div class="block__form"><ul class="activity" data-activity><li><span class="muted">Loading…</span></li></ul></div>
    </section>`
        : ''
    }`;
  enter(root);

  $('[data-signout]', root)?.addEventListener('click', signOut);

  $('[data-stock-form]', root).addEventListener('submit', (e) => {
    e.preventDefault();
    const v = Math.round(Number($('#s-low', root).value));
    if (!(v >= 0 && v <= 999)) return toast('Enter a number from 0 to 999.');
    try {
      update((st) => (st.settings.lowStock = v)).then(() => toast('Low-stock alert saved'), () => {});
      if (!LIVE) toast('Low-stock alert saved');
    } catch (err) {
      toast(describeError(err));
    }
  });

  $('[data-ship-form]', root).addEventListener('submit', (e) => {
    e.preventDefault();
    const n = (id) => Math.round(Number($(id, root).value));
    const v = { shippingFee: n('#sh-fee'), freeShippingOver: n('#sh-free'), codEnabled: $('#sh-cod', root).checked, codFee: n('#sh-codfee'), codMax: n('#sh-codmax'), holdMinutes: n('#sh-hold'),
      pickupLocation: $('#sh-loc', root).value.trim() || 'Primary', pickupPin: $('#sh-pin', root).value.trim(), returnWindowDays: n('#sh-ret') };
    if (v.pickupPin && !/^[1-9][0-9]{5}$/.test(v.pickupPin)) return toast('The pickup PIN code must be 6 digits.');
    if (!(v.returnWindowDays >= 0 && v.returnWindowDays <= 60)) return toast('Return window: 0 to 60 days.');
    if ([v.shippingFee, v.freeShippingOver, v.codFee, v.codMax].some((x) => !(x >= 0))) return toast('Use whole rupee amounts of 0 or more.');
    if (!(v.holdMinutes >= 5 && v.holdMinutes <= 120)) return toast('Hold items for 5 to 120 minutes.');
    try {
      update((st) => Object.assign(st.settings, v)).then(() => LIVE && toast('Shipping and payment saved'), () => {});
      if (!LIVE) toast('Shipping and payment saved');
    } catch (err) {
      toast(describeError(err));
    }
  });

  $('[data-biz-form]', root).addEventListener('submit', (e) => {
    e.preventDefault();
    const val = (id) => $(id, root).value.trim();
    const gstin = val('#b-gstin').toUpperCase();
    const phone = val('#b-phone').replace(/\D/g, '');
    const prefix = val('#b-prefix').toUpperCase();
    if (gstin && !/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(gstin)) return toast('That GSTIN doesn’t look right (15 characters, e.g. 27ABCDE1234F1Z5).');
    if ($('#b-reg', root).checked && !gstin) return toast('Add your GSTIN, or turn off “Registered under GST”.');
    if (phone && !/^[6-9][0-9]{9}$/.test(phone)) return toast('Enter a 10-digit mobile number.');
    if (!/^[A-Z0-9]{1,6}$/.test(prefix)) return toast('Invoice prefix: 1–6 letters or numbers.');
    try {
      update((st) => Object.assign(st.settings, {
        legalName: val('#b-name'), businessAddress: val('#b-addr'), businessCity: val('#b-city'), businessState: $('#b-state', root).value,
        businessPhone: phone ? '+91' + phone : '', invoicePrefix: prefix, gstRegistered: $('#b-reg', root).checked, gstin,
      })).then(() => LIVE && toast('Business details saved'), () => {});
      if (!LIVE) toast('Business details saved');
    } catch (err) {
      toast(describeError(err));
    }
  });

  $('[data-notify-form]', root).addEventListener('submit', (e) => {
    e.preventDefault();
    const em = $('#n-email', root).value.trim();
    if (em && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)) return toast('Enter a valid email address, or leave it empty.');
    try {
      update((st) => Object.assign(st.settings, { notifyEmail: em, abandonedCartEnabled: $('#n-cart', root).checked })).then(() => LIVE && toast('Notifications saved'), () => {});
      if (!LIVE) toast('Notifications saved');
    } catch (err) {
      toast(describeError(err));
    }
  });

  const loadOutbox = async () => {
    const ul = $('[data-outbox]', root);
    if (!ul) return;
    const { data, error } = await supabase.from('email_outbox').select('id, kind, to_email, status, created_at, sent_at, last_error, related_order').order('id', { ascending: false }).limit(30);
    if (!ul.isConnected) return;
    if (error) return (ul.innerHTML = `<li class="muted">${esc(describeError(error))}</li>`);
    ul.innerHTML = data.length
      ? data
          .map(
            (m) => `<li><span>${esc(MAIL_LABEL[m.kind] || m.kind)}${m.related_order ? ` · ${esc(m.related_order)}` : ''}<br><span class="muted" style="font-size:.8125rem">${esc(m.to_email)}${m.last_error ? ` · ${esc(m.last_error)}` : ''}</span></span>
            <span class="muted">${MAIL_STATUS[m.status] || m.status}${owner && ['failed', 'skipped'].includes(m.status) ? ` <button class="text-btn" data-retry="${m.id}">Retry</button>` : ''}</span></li>`,
          )
          .join('')
      : '<li class="muted">No emails yet.</li>';
  };
  if (LIVE) loadOutbox();
  on('click', async (e) => {
    const b = e.target.closest('[data-retry]');
    if (!b) return;
    const { error } = await supabase.rpc('retry_email', { p_id: Number(b.dataset.retry) });
    toast(error ? describeError(error) : 'Queued to send again');
    loadOutbox();
  });

  if (owner && LIVE) {
    supabase
      .from('newsletter_subscribers')
      .select('email', { count: 'exact', head: true })
      .eq('status', 'subscribed')
      .then(({ count }) => {
        const el = $('[data-subs]', root);
        if (el) el.textContent = `${count ?? 0} confirmed ${count === 1 ? 'subscriber' : 'subscribers'}.`;
      });
    $('[data-csv]', root).addEventListener('click', async () => {
      const { data, error } = await supabase.from('newsletter_subscribers').select('email, source, confirmed_at').eq('status', 'subscribed').order('confirmed_at');
      if (error) return toast(describeError(error));
      const csv = 'email,source,confirmed_at\n' + data.map((r) => [r.email, r.source, r.confirmed_at].map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
      a.download = `vertu-subscribers-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
    });
  }

  if (!(owner && LIVE)) return;

  const loadTeam = async () => {
    const { data, error } = await supabase.rpc('team_list');
    const box = $('[data-team]', root);
    if (!box) return;
    if (error) return (box.innerHTML = `<p class="empty">${esc(describeError(error))}</p>`);
    box.innerHTML = data
      .map(
        (m) => `<div class="list__row"><div class="list__main"><strong>${esc(m.email)}</strong>
          <span>${m.role === 'owner' ? 'Owner' : 'Staff'}${m.last_sign_in_at ? `, last signed in ${when(m.last_sign_in_at)}` : ''}</span></div>
          ${m.user_id === session.userId ? '<span class="pill">You</span>' : `<button class="text-btn" data-remove="${m.user_id}" data-email="${esc(m.email)}">Remove</button>`}</div>`,
      )
      .join('');
  };
  const loadActivity = async () => {
    const { data, error } = await supabase.rpc('activity', { p_limit: 40 });
    const ul = $('[data-activity]', root);
    if (!ul) return;
    if (error) return (ul.innerHTML = `<li>${esc(describeError(error))}</li>`);
    ul.innerHTML = data.length
      ? data
          .map(
            (a) => `<li><time>${when(a.created_at)}</time><span><strong style="font-weight:500">${esc(ENTITY[a.entity] || a.entity)}${a.entity_id && a.entity !== 'site_content' && a.entity !== 'settings' ? ` ${esc(a.entity_id.length > 20 ? '' : a.entity_id)}` : ''}</strong>: ${esc(describe(a))}<br><span class="muted">${esc(a.email || 'system')}</span></span></li>`,
          )
          .join('')
      : '<li><span class="muted">Nothing yet.</span></li>';
  };
  loadTeam();
  loadActivity();

  $('[data-add-form]', root).addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('[data-team-err]', root);
    err.textContent = '';
    const email = $('#t-email', root).value.trim();
    if (!/^\S+@\S+\.\S+$/.test(email)) return (err.textContent = 'Enter a valid email address.');
    const { error } = await supabase.rpc('team_grant', { p_email: email, p_role: $('#t-role', root).value });
    if (error) {
      err.textContent = /no_account/.test(error.message)
        ? 'There’s no account with that email yet. Create it in Supabase (Authentication → Add user), then add it here.'
        : /cannot_demote_self/.test(error.message)
          ? 'You can’t remove your own owner role.'
          : describeError(error);
      return;
    }
    $('#t-email', root).value = '';
    toast(`${email} added`);
    loadTeam();
    loadActivity();
  });
  on('click', async (e) => {
    const b = e.target.closest('[data-remove]');
    if (!b) return;
    const ok = await confirmDialog({ title: 'Remove from the team?', body: `${b.dataset.email} will no longer be able to use the store manager. Their account itself is kept.`, ok: 'Remove' });
    if (!ok) return;
    const { error } = await supabase.rpc('team_revoke', { p_user: b.dataset.remove });
    if (error) return toast(describeError(error));
    toast('Removed from the team');
    loadTeam();
    loadActivity();
  });
}

import '../styles.css';
import '../pages.css';
import { fmt, bySku } from '../data.js';
import { cart, toast } from '../cart.js';
import { mountChrome } from '../chrome.js';
import { customer, customerReady, wishlist, accountsEnabled, sendCode, verifyCode, googleEnabled, signInWithGoogle, signOut } from '../customer.js';
import { supabase } from '../lib/supabase.js';
import { orderFromRow } from '../lib/sync.js';
import { INDIAN_STATES, validPin } from '../delivery.js';
import { esc, $, $$, tile, bindWishButtons } from './ui.js';

mountChrome({ current: 'account' });
const main = $('#main');
const STEPS = ['Pending', 'Processing', 'Shipped', 'Delivered'];
const STEP_LABEL = { Pending: 'Order placed', Processing: 'Being packed', Shipped: 'On the way', Delivered: 'Delivered' };
const TABS = { orders: 'Orders', wishlist: 'Wishlist', addresses: 'Addresses', profile: 'Profile' };
const friendly = (e) => {
  const m = e?.message || '';
  if (/rate limit|too many|security purposes/i.test(m)) return 'Too many attempts. Wait a minute, then try again.';
  if (/expired|invalid/i.test(m)) return 'That code didn’t work or has expired. Request a new one.';
  if (/fetch|network/i.test(m)) return 'Could not reach the server. Check your connection.';
  return m || 'Something went wrong. Please try again.';
};

if (!accountsEnabled) {
  sampleMode();
} else {
  main.innerHTML = '<p class="page-loading">Loading your account…</p>';
  await customerReady;
  let lastId;
  customer.onChange((u) => {
    if ((u && u.id) === lastId) return;
    lastId = u && u.id;
    u ? dashboard() : signInView();
  });
}

/* ------------------------------------------------------------ sample mode */
function sampleMode() {
  main.innerHTML = `<h1 class="page-title">Your account</h1>
    <p class="lede">Accounts switch on once the store is connected to its database. Until then, your wishlist is kept on this device.</p>
    <div class="acct" style="grid-template-columns:1fr"><div class="acct__panel" data-panel></div></div>`;
  wishlistPanel($('[data-panel]', main));
}

/* ------------------------------------------------------------ sign in */
function signInView(email = '') {
  document.title = 'Sign in | VERTU';
  main.innerHTML = `<div class="signin">
    <h1 class="page-title">Sign in</h1>
    <p class="lede" style="margin-top:0">Track orders, keep a wishlist and check out faster. New here? The same steps create your account.</p>
    ${googleEnabled ? `<button type="button" class="btn btn--ghost" data-google>Continue with Google</button><p class="or">or with email</p>` : ''}
    <form data-email-form novalidate>
      <div class="field"><label for="si-email">Email</label><input class="input" id="si-email" type="email" autocomplete="email" value="${esc(email)}" required /></div>
      <p class="err" data-err role="alert"></p>
      <button type="submit" class="btn btn--ink">Email me a sign-in code</button>
    </form>
    <p class="fine">By continuing you agree to our terms and privacy policy. We only use your email for your orders and account, unless you choose otherwise.</p>
  </div>`;
  $('[data-google]', main)?.addEventListener('click', () => signInWithGoogle().catch((e) => toast(friendly(e))));
  const form = $('[data-email-form]', main);
  setTimeout(() => $('#si-email', main).focus(), 50);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('[data-err]', main);
    const btn = $('button[type=submit]', form);
    const value = $('#si-email', main).value.trim();
    err.textContent = '';
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)) return (err.textContent = 'Enter a valid email address.');
    btn.disabled = true;
    btn.textContent = 'Sending…';
    try {
      await sendCode(value);
      codeView(value);
    } catch (x) {
      err.textContent = friendly(x);
      btn.disabled = false;
      btn.textContent = 'Email me a sign-in code';
    }
  });
}

function codeView(email) {
  main.innerHTML = `<div class="signin">
    <h1 class="page-title">Check your email</h1>
    <p class="lede" style="margin-top:0">We sent a 6-digit code to <strong>${esc(email)}</strong>. It expires in an hour. You can also tap the link in the email.</p>
    <form data-code-form novalidate>
      <div class="field"><label for="si-code">Code</label><input class="input" id="si-code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" required /></div>
      <p class="err" data-err role="alert"></p>
      <button type="submit" class="btn btn--ink">Sign in</button>
    </form>
    <p class="fine"><button type="button" class="link-btn" data-resend>Send a new code</button> · <button type="button" class="link-btn" data-change>Use a different email</button></p>
  </div>`;
  setTimeout(() => $('#si-code', main).focus(), 50);
  $('[data-change]', main).addEventListener('click', () => signInView(email));
  $('[data-resend]', main).addEventListener('click', async () => {
    try {
      await sendCode(email);
      toast('A new code is on its way');
    } catch (x) {
      toast(friendly(x));
    }
  });
  $('[data-code-form]', main).addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('[data-err]', main);
    const btn = $('button[type=submit]', e.currentTarget);
    const code = $('#si-code', main).value.replace(/\D/g, '');
    err.textContent = '';
    if (code.length !== 6) return (err.textContent = 'Enter all 6 digits.');
    btn.disabled = true;
    btn.textContent = 'Signing in…';
    try {
      await verifyCode(email, code);
      // the session change re-renders this page as the dashboard
    } catch (x) {
      err.textContent = friendly(x);
      btn.disabled = false;
      btn.textContent = 'Sign in';
    }
  });
}

/* ------------------------------------------------------------ dashboard */
function dashboard() {
  const u = customer.user;
  document.title = 'Your account | VERTU';
  main.innerHTML = `<h1 class="page-title">Hello${u.user_metadata?.full_name ? `, ${esc(u.user_metadata.full_name.split(' ')[0])}` : ''}.</h1>
    <p class="lede">Signed in as ${esc(u.email)}</p>
    <div class="acct">
      <nav class="acct__nav" aria-label="Account">${Object.entries(TABS).map(([k, v]) => `<a href="#${k}" data-tab="${k}">${v}</a>`).join('')}
        <button type="button" class="link-btn" data-signout>Sign out</button></nav>
      <div class="acct__panel" data-panel aria-live="polite"></div>
    </div>`;
  $('[data-signout]', main).addEventListener('click', async () => {
    await signOut();
    toast('Signed out. Your bag and wishlist were cleared from this device.');
  });
  const show = () => {
    const tab = TABS[location.hash.slice(1)] ? location.hash.slice(1) : 'orders';
    $$('[data-tab]', main).forEach((a) => (a.dataset.tab === tab ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));
    const panel = $('[data-panel]', main);
    panel.innerHTML = '<p class="page-loading">Loading…</p>';
    ({ orders: ordersPanel, wishlist: wishlistPanel, addresses: addressesPanel, profile: profilePanel })[tab](panel);
  };
  window.onhashchange = show;
  show();
}

async function ordersPanel(panel) {
  const { data, error } = await supabase.from('orders').select('*, order_items(*)').order('created_at', { ascending: false });
  if (error) return (panel.innerHTML = `<p class="err">${esc(friendly(error))}</p>`);
  const orders = data.map(orderFromRow);
  panel.innerHTML = `<h2>Orders</h2>${
    orders.length
      ? orders
          .map((o) => {
            const at = STEPS.indexOf(o.status);
            const total = o.lines.reduce((n, l) => n + l.price * l.qty, 0);
            return `<article class="order"><div class="order__head"><strong>${esc(o.id)}</strong>
              <span>${new Date(o.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}</span></div>
              <ol class="steps" aria-label="Status: ${esc(STEP_LABEL[o.status])}">${STEPS.map((s, i) => `<li class="${i <= at ? 'is-done' : ''}">${STEP_LABEL[s]}</li>`).join('')}</ol>
              <ul class="order__lines">${o.lines.map((l) => `<li><span>${esc(l.colour)} ${esc(bySku(l.sku)?.product.name || l.category)} <em>× ${l.qty}</em></span><span>${fmt(l.price * l.qty)}</span></li>`).join('')}</ul>
              <div class="order__total"><span>Total</span><span>${fmt(total)}</span></div>
              <p class="fine" style="margin-top:12px">Ships to ${esc(o.customer.address)}, ${esc(o.customer.city)} ${esc(o.customer.pin)}</p></article>`;
          })
          .join('')
      : `<div class="empty-state" style="padding-top:0"><p>No orders yet. When you buy something it will show up here, with where it is on its way to you.</p><a class="btn btn--ink" href="../shop/">Go to the shop</a></div>`
  }`;
}

function wishlistPanel(panel) {
  const draw = () => {
    const items = wishlist.items.map(bySku).filter(Boolean);
    panel.innerHTML = `<h2>Wishlist</h2>${
      items.length
        ? `<div class="tiles">${items
            .map((x) =>
              tile(x, '../', {
                actions: `<div class="tile__actions">${x.colour.stock > 0 ? `<button type="button" class="text-link" data-bag="${x.colour.sku}">Add to bag</button>` : '<span class="fine">Sold out</span>'}</div>`,
              }),
            )
            .join('')}</div>`
        : `<div class="empty-state" style="padding-top:0"><p>Nothing saved yet. Tap the heart on any bag to keep it here.</p><a class="btn btn--ink" href="../shop/">Browse the shop</a></div>`
    }`;
  };
  draw();
  if (!panel.dataset.bound) {
    panel.dataset.bound = '1';
    bindWishButtons(panel);
    panel.addEventListener('click', (e) => {
      const b = e.target.closest('[data-bag]');
      if (!b) return;
      const x = bySku(b.dataset.bag);
      toast(cart.add(b.dataset.bag, 1) ? `${x.colour.name} ${x.product.name} added to your bag` : 'Your bag already has all we have in this colour');
    });
  }
  const off = wishlist.subscribe(() => (panel.isConnected && panel.querySelector('h2')?.textContent === 'Wishlist' ? draw() : off()));
}

async function addressesPanel(panel) {
  const { data, error } = await supabase.from('addresses').select('*').order('is_default', { ascending: false }).order('created_at');
  if (error) return (panel.innerHTML = `<p class="err">${esc(friendly(error))}</p>`);
  panel.innerHTML = `<h2>Addresses</h2>
    ${
      data.length
        ? `<div class="addr-grid">${data
            .map(
              (a) => `<div class="addr${a.is_default ? ' is-default' : ''}" data-id="${a.id}">
            <p class="addr__label">${esc(a.label || a.full_name)}${a.is_default ? '<span>Default</span>' : ''}</p>
            <p>${esc(a.full_name)}</p><p>${esc(a.line1)}${a.line2 ? `, ${esc(a.line2)}` : ''}</p><p>${esc(a.city)}, ${esc(a.state)} ${esc(a.pin)}</p><p class="fine">${esc(a.phone)}</p>
            <div class="addr__actions"><button class="text-link" data-edit>Edit</button>${a.is_default ? '' : '<button class="text-link" data-default>Make default</button>'}<button class="text-link" data-del>Delete</button></div></div>`,
            )
            .join('')}</div>`
        : '<p class="lede" style="margin-top:0">No saved addresses yet. Add one now and checkout fills it in for you.</p>'
    }
    <div style="margin-top:28px" data-form-slot>${data.length < 10 ? '<button class="btn btn--ink" data-new>Add an address</button>' : '<p class="fine">You’ve saved the maximum of 10 addresses.</p>'}</div>`;

  panel.onclick = async (e) => {
    const card = e.target.closest('[data-id]');
    if (e.target.closest('[data-new]')) return addressForm(panel, null);
    if (!card) return;
    const a = data.find((x) => x.id === card.dataset.id);
    if (e.target.closest('[data-edit]')) return addressForm(panel, a);
    if (e.target.closest('[data-default]')) {
      const { error: x } = await supabase.from('addresses').update({ is_default: true }).eq('id', a.id);
      if (x) return toast(friendly(x));
      toast('Default address updated');
      return addressesPanel(panel);
    }
    if (e.target.closest('[data-del]')) {
      if (!confirm(`Delete the address for ${a.full_name}?`)) return;
      const { error: x } = await supabase.from('addresses').delete().eq('id', a.id);
      if (x) return toast(friendly(x));
      toast('Address deleted');
      return addressesPanel(panel);
    }
  };
}

function addressForm(panel, a) {
  const slot = $('[data-form-slot]', panel);
  const v = a || { full_name: customer.user.user_metadata?.full_name || '', phone: '', line1: '', line2: '', city: '', state: '', pin: '', label: '', is_default: false };
  const phone = (v.phone || '').replace(/^\+91/, '');
  slot.innerHTML = `<form class="section-rule" data-addr-form novalidate>
    <h3>${a ? 'Edit address' : 'New address'}</h3>
    <div class="form-grid">
      <div class="field"><label for="a-name">Full name</label><input class="input" id="a-name" name="full_name" autocomplete="name" value="${esc(v.full_name)}" required /></div>
      <div class="field"><label for="a-phone">Mobile number</label><div class="inline"><span class="input" style="flex:none;width:64px;display:grid;place-items:center;color:var(--ink-2)">+91</span><input class="input" id="a-phone" name="phone" inputmode="numeric" autocomplete="tel-national" maxlength="10" value="${esc(phone)}" required /></div></div>
      <div class="field full"><label for="a-l1">House, building, street</label><input class="input" id="a-l1" name="line1" autocomplete="address-line1" value="${esc(v.line1)}" required /></div>
      <div class="field full"><label for="a-l2">Area, landmark <span class="fine">(optional)</span></label><input class="input" id="a-l2" name="line2" autocomplete="address-line2" value="${esc(v.line2)}" /></div>
      <div class="field"><label for="a-pin">PIN code</label><input class="input" id="a-pin" name="pin" inputmode="numeric" autocomplete="postal-code" maxlength="6" value="${esc(v.pin)}" required /></div>
      <div class="field"><label for="a-city">City</label><input class="input" id="a-city" name="city" autocomplete="address-level2" value="${esc(v.city)}" required /></div>
      <div class="field"><label for="a-state">State</label><select class="select" id="a-state" name="state" autocomplete="address-level1" required><option value="">Choose…</option>${INDIAN_STATES.map((s) => `<option ${s === v.state ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
      <div class="field"><label for="a-label">Label <span class="fine">(optional)</span></label><input class="input" id="a-label" name="label" maxlength="40" placeholder="Home, Office" value="${esc(v.label)}" /></div>
      <label class="check full"><input type="checkbox" name="is_default" ${v.is_default ? 'checked' : ''} /><span>Use as my default address</span></label>
    </div>
    <p class="err" data-err role="alert" style="margin-top:14px"></p>
    <div class="form-actions"><button class="btn btn--ink" type="submit">Save address</button><button class="btn btn--ghost" type="button" data-cancel>Cancel</button></div>
  </form>`;
  const form = $('[data-addr-form]', slot);
  form.full_name.focus();
  $('[data-cancel]', form).addEventListener('click', () => addressesPanel(panel));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('[data-err]', form);
    const val = (n) => form[n].value.trim();
    const row = {
      full_name: val('full_name'),
      phone: '+91' + val('phone').replace(/\D/g, ''),
      line1: val('line1'),
      line2: val('line2'),
      pin: val('pin'),
      city: val('city'),
      state: form.state.value,
      label: val('label'),
      is_default: form.is_default.checked,
    };
    $$('[aria-invalid]', form).forEach((x) => x.removeAttribute('aria-invalid'));
    const bad = [
      [!row.full_name, 'full_name', 'Enter the name of the person receiving it.'],
      [!/^\+91[6-9][0-9]{9}$/.test(row.phone), 'phone', 'Enter a 10-digit Indian mobile number.'],
      [!row.line1, 'line1', 'Enter the house and street.'],
      [!validPin(row.pin), 'pin', 'Enter a 6-digit PIN code.'],
      [!row.city, 'city', 'Enter the city.'],
      [!row.state, 'state', 'Choose the state.'],
    ].find(([cond]) => cond);
    if (bad) {
      form[bad[1]].setAttribute('aria-invalid', 'true');
      form[bad[1]].focus();
      return (err.textContent = bad[2]);
    }
    const q = a ? supabase.from('addresses').update(row).eq('id', a.id) : supabase.from('addresses').insert(row);
    const { error } = await q;
    if (error) return (err.textContent = /address_limit/.test(error.message) ? 'You’ve saved the maximum of 10 addresses.' : friendly(error));
    toast(a ? 'Address updated' : 'Address saved');
    addressesPanel(panel);
  });
}

async function profilePanel(panel) {
  const u = customer.user;
  const { data: p, error } = await supabase.from('profiles').select('*').eq('id', u.id).maybeSingle();
  if (error) return (panel.innerHTML = `<p class="err">${esc(friendly(error))}</p>`);
  const v = p || { full_name: '', phone: '', marketing_opt_in: false };
  panel.innerHTML = `<h2>Profile</h2>
    <div class="stack-lg">
      <form data-profile novalidate>
        <div class="form-grid">
          <div class="field"><label for="p-name">Name</label><input class="input" id="p-name" name="full_name" autocomplete="name" maxlength="120" value="${esc(v.full_name)}" /></div>
          <div class="field"><label for="p-email">Email</label><input class="input" id="p-email" value="${esc(u.email)}" disabled /><small>This is how you sign in.</small></div>
          <div class="field"><label for="p-phone">Mobile number <span class="fine">(optional)</span></label><div class="inline"><span class="input" style="flex:none;width:64px;display:grid;place-items:center;color:var(--ink-2)">+91</span><input class="input" id="p-phone" name="phone" inputmode="numeric" maxlength="10" value="${esc((v.phone || '').replace(/^\+91/, ''))}" /></div></div>
          <label class="check full"><input type="checkbox" name="marketing_opt_in" ${v.marketing_opt_in ? 'checked' : ''} /><span>Email me about new colours and launches. A few times a year, never shared.</span></label>
        </div>
        <p class="err" data-err role="alert" style="margin-top:14px"></p>
        <div class="form-actions"><button class="btn btn--ink" type="submit">Save</button></div>
      </form>
      <section class="section-rule"><h3>Your data</h3>
        <p class="lede" style="margin-top:0">You can ask for a copy of what we hold about you, or for your account and personal details to be deleted. We reply within 30 days. Order records we must keep for tax are kept for the period the law requires.</p>
        <div class="form-actions"><button class="btn btn--ghost" data-req="export">Request my data</button><button class="btn btn--ghost" data-req="delete">Delete my account</button></div>
      </section>
    </div>`;
  const form = $('[data-profile]', panel);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('[data-err]', form);
    const digits = form.phone.value.replace(/\D/g, '');
    if (digits && !/^[6-9][0-9]{9}$/.test(digits)) return (err.textContent = 'Enter a 10-digit Indian mobile number, or leave it empty.');
    err.textContent = '';
    const { error: x } = await supabase
      .from('profiles')
      .update({ full_name: form.full_name.value.trim(), phone: digits ? '+91' + digits : '', marketing_opt_in: form.marketing_opt_in.checked })
      .eq('id', u.id);
    if (x) return (err.textContent = friendly(x));
    toast('Profile saved');
  });
  panel.querySelectorAll('[data-req]').forEach((b) =>
    b.addEventListener('click', async () => {
      const kind = b.dataset.req;
      if (kind === 'delete' && !confirm('Ask us to delete your account and personal details? Your orders in progress will still be delivered.')) return;
      const { error: x } = await supabase.from('data_requests').insert({ kind, email: u.email });
      if (x) return toast(friendly(x));
      toast(kind === 'delete' ? 'Request received. We’ll confirm by email.' : 'Request received. We’ll email you a copy.');
      b.disabled = true;
    }),
  );
}

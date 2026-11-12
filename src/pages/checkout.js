import '../monitor.js';
import '../styles.css';
import '../pages.css';
import { bySku, fmt } from '../data.js';
import { cart, toast } from '../cart.js';
import { mountChrome } from '../chrome.js';
import { customer, customerReady, accountsEnabled } from '../customer.js';
import { LIVE, supabase, callFunction } from '../lib/supabase.js';
import { getState, update } from '../store.js';
import { priceCart, COUPON_REASON } from '../lib/pricing.js';
import { INDIAN_STATES, validPin, liveEstimate } from '../delivery.js';
import { esc, $, $$ } from './ui.js';
import { track } from '../analytics.js';

mountChrome({ current: 'checkout' });
const main = $('#main');
const PENDING = 'vertu.pending';
const form = { coupon: '', method: 'razorpay', addressId: '' };
let quote = null;
let addresses = [];
let paying = false;

const cartSig = () => JSON.stringify(cart.items.map((i) => [i.sku, i.qty]));
const readPending = () => {
  try {
    const p = JSON.parse(sessionStorage.getItem(PENDING) || 'null');
    return p && p.sig === cartSig() ? p : null;
  } catch (_) {
    return null;
  }
};
const savePending = (p) => {
  try {
    sessionStorage.setItem(PENDING, JSON.stringify({ ...p, sig: cartSig() }));
  } catch (_) {
    /* optional */
  }
};
const clearPending = () => {
  try {
    sessionStorage.removeItem(PENDING);
  } catch (_) {
    /* optional */
  }
};

await customerReady;
if (!cart.items.length) {
  main.innerHTML = `<div class="empty-state"><h1 class="page-title">Your bag is empty.</h1><p>Choose a colour you love, then come back here to check out.</p><a class="btn btn--ink" href="../shop/">Go to the shop</a></div>`;
} else {
  track('begin_checkout', {
    value: cart.items.reduce((n, i) => n + (bySku(i.sku)?.colour.price || 0) * i.qty, 0),
    items: cart.items.map((i) => ({ sku: i.sku, name: bySku(i.sku)?.product.name, colour: bySku(i.sku)?.colour.name, price: bySku(i.sku)?.colour.price, qty: i.qty })),
  });
  if (accountsEnabled && customer.user) {
    const { data } = await supabase.from('addresses').select('*').order('is_default', { ascending: false }).order('created_at');
    addresses = data || [];
    form.addressId = addresses[0]?.id || '';
  }
  render();
}

function render() {
  const u = customer.user;
  const saved = addresses.length > 0;
  main.innerHTML = `
    <h1 class="page-title">Checkout</h1>
    ${accountsEnabled && !u ? `<p class="lede">Have an account? <a class="text-link" href="../account/?next=checkout">Sign in</a> to use your saved addresses. Or carry on as a guest.</p>` : ''}
    ${!LIVE ? '<p class="lede">Sample mode: no payment is taken. Placing an order adds it to the store manager so you can try the whole flow.</p>' : ''}
    <div class="checkout">
      <form class="checkout__form" data-form novalidate>
        <section class="co-step" aria-labelledby="co-contact">
          <h2 id="co-contact">Contact</h2>
          <div class="form-grid">
            <div class="field"><label for="c-email">Email</label><input class="input" id="c-email" name="email" type="email" autocomplete="email" value="${esc(u?.email || '')}" ${u ? 'readonly' : ''} required /><small>For your order updates. <a href="../legal/?p=privacy">How we use your details</a></small></div>
            <div class="field"><label for="c-phone">Mobile number</label><div class="inline"><span class="input prefix">+91</span><input class="input" id="c-phone" name="phone" inputmode="numeric" autocomplete="tel-national" maxlength="10" required /></div><small>The courier may call about delivery.</small></div>
          </div>
        </section>

        <section class="co-step" aria-labelledby="co-address">
          <h2 id="co-address">Delivery address</h2>
          ${
            saved
              ? `<div class="choices" role="radiogroup" aria-label="Saved addresses">${addresses
                  .map(
                    (a) => `<label class="choice"><input type="radio" name="addr" value="${a.id}" ${a.id === form.addressId ? 'checked' : ''} />
                <span><strong>${esc(a.label || a.full_name)}</strong><br>${esc(a.full_name)}, ${esc(a.line1)}${a.line2 ? `, ${esc(a.line2)}` : ''}, ${esc(a.city)}, ${esc(a.state)} ${esc(a.pin)}<br><span class="fine">${esc(a.phone)}</span></span></label>`,
                  )
                  .join('')}
                <label class="choice"><input type="radio" name="addr" value="" ${form.addressId ? '' : 'checked'} /><span><strong>Use a new address</strong></span></label></div>`
              : ''
          }
          <div class="form-grid" data-new-address ${saved && form.addressId ? 'hidden' : ''}>
            <div class="field full"><label for="a-name">Full name</label><input class="input" id="a-name" name="full_name" autocomplete="name" value="${esc(u?.user_metadata?.full_name || '')}" /></div>
            <div class="field full"><label for="a-l1">House, building, street</label><input class="input" id="a-l1" name="line1" autocomplete="address-line1" /></div>
            <div class="field full"><label for="a-l2">Area, landmark <span class="fine">(optional)</span></label><input class="input" id="a-l2" name="line2" autocomplete="address-line2" /></div>
            <div class="field"><label for="a-pin">PIN code</label><input class="input" id="a-pin" name="pin" inputmode="numeric" autocomplete="postal-code" maxlength="6" /></div>
            <div class="field"><label for="a-city">City</label><input class="input" id="a-city" name="city" autocomplete="address-level2" /></div>
            <div class="field full"><label for="a-state">State</label><select class="select" id="a-state" name="state" autocomplete="address-level1"><option value="">Choose…</option>${INDIAN_STATES.map((s) => `<option>${s}</option>`).join('')}</select></div>
            ${u ? '<label class="check full"><input type="checkbox" name="save_address" checked /><span>Save this address to my account</span></label>' : ''}
          </div>
          <p class="deliver__out" data-eta aria-live="polite"></p>
          <div class="field" style="margin-top:18px"><label for="c-note">Delivery instructions <span class="fine">(optional)</span></label><input class="input" id="c-note" name="note" maxlength="200" placeholder="e.g. Leave with the security desk" /></div>
        </section>

        <section class="co-step" aria-labelledby="co-pay">
          <h2 id="co-pay">Payment</h2>
          <div class="choices" role="radiogroup" aria-label="Payment method" data-methods></div>
        </section>

        <div class="co-problems" data-problems role="alert" hidden></div>
        <button class="btn btn--accent btn--block co-pay" type="submit" data-pay disabled>Loading total…</button>
        <p class="fine co-legal">By placing your order you agree to our <a href="../legal/?p=terms">terms</a> and our <a href="../legal/?p=shipping">shipping</a>, <a href="../legal/?p=returns">returns</a> and <a href="../legal/?p=cancellation">cancellation</a> policies. Prices include GST. Nothing is added after this page.</p>
      </form>

      <aside class="summary" aria-labelledby="co-sum">
        <h2 id="co-sum">Your bag</h2>
        <ul class="summary__lines" data-lines></ul>
        <form class="inline summary__coupon" data-coupon-form novalidate>
          <input class="input" name="coupon" placeholder="Discount code" aria-label="Discount code" autocapitalize="characters" value="${esc(form.coupon)}" />
          <button class="btn btn--ghost" type="submit">Apply</button>
        </form>
        <p class="fine" data-coupon-msg aria-live="polite"></p>
        <dl class="summary__totals" data-totals></dl>
      </aside>
    </div>`;

  const f = $('[data-form]', main);
  f.addEventListener('change', (e) => {
    if (e.target.name === 'addr') {
      form.addressId = e.target.value;
      $('[data-new-address]', main).hidden = !!form.addressId;
      eta();
    }
    if (e.target.name === 'method') {
      form.method = e.target.value;
      refresh();
    }
  });
  f.pin.addEventListener('input', eta);
  f.addEventListener('submit', (e) => {
    e.preventDefault();
    pay();
  });
  $('[data-coupon-form]', main).addEventListener('submit', (e) => {
    e.preventDefault();
    form.coupon = e.currentTarget.coupon.value.trim().toUpperCase();
    refresh();
  });
  eta();
  refresh();
}

function currentAddress() {
  const f = $('[data-form]', main);
  if (form.addressId) {
    const a = addresses.find((x) => x.id === form.addressId);
    return a && { full_name: a.full_name, line1: a.line1, line2: a.line2, city: a.city, state: a.state, pin: a.pin, phone: a.phone };
  }
  const v = (n) => f[n].value.trim();
  return { full_name: v('full_name'), line1: v('line1'), line2: v('line2'), city: v('city'), state: f.state.value, pin: v('pin') };
}

let pinCheck = { pin: '', serviceable: true, cod: true };
let etaTimer;
function eta() {
  clearTimeout(etaTimer);
  etaTimer = setTimeout(async () => {
    const pin = currentAddress()?.pin || '';
    const box = $('[data-eta]', main);
    if (!validPin(pin)) {
      pinCheck = { pin: '', serviceable: true, cod: true };
      box.innerHTML = '';
      return quote && drawSummary();
    }
    const e = await liveEstimate(pin);
    if ((currentAddress()?.pin || '') !== pin) return; // typed on meanwhile
    pinCheck = { pin, serviceable: e.serviceable, cod: e.cod };
    box.innerHTML = e.serviceable
      ? `Estimated delivery: <strong>${e.label}</strong>${e.cod ? '' : '. Cash on delivery isn’t available for this PIN.'}`
      : `<strong>We can’t deliver to ${esc(pin)} yet.</strong> Check the PIN code, or write to us and we’ll find a way.`;
    if (quote) drawSummary();
  }, 250);
}

async function getQuote() {
  const items = cart.items.map((i) => ({ sku: i.sku, qty: i.qty }));
  if (LIVE) {
    const { data, error } = await supabase.rpc('quote_checkout', { p_items: items, p_coupon: form.coupon || null, p_method: form.method });
    if (error) throw error;
    return data;
  }
  const s = getState();
  return priceCart(items, form.coupon, form.method, {
    products: new Map(s.products.map((p) => [p.id, p])),
    settings: s.settings,
    coupons: s.coupons || [],
  });
}

async function refresh() {
  const btn = $('[data-pay]', main);
  btn.disabled = true;
  try {
    quote = await getQuote();
  } catch (e) {
    $('[data-problems]', main).hidden = false;
    $('[data-problems]', main).textContent = 'We couldn’t load your total. Check your connection and refresh the page.';
    return;
  }
  // Fix what we can automatically: drop unavailable lines, lower quantities to what's left.
  const fixes = [];
  for (const p of quote.problems || []) {
    const hit = bySku(p.sku);
    const name = hit ? `${hit.colour.name} ${hit.product.name}` : 'An item';
    if (p.kind === 'unavailable' || (p.kind === 'insufficient' && !p.available)) {
      cart.setQty(p.sku, 0);
      fixes.push(`${name} is no longer available and was removed.`);
    } else if (p.kind === 'insufficient') {
      cart.setQty(p.sku, p.available);
      fixes.push(`Only ${p.available} ${name} left, so we changed the quantity.`);
    }
  }
  if (fixes.length) {
    toast(fixes[0]);
    if (!cart.items.length) return location.reload();
    $('[data-problems]', main).hidden = false;
    $('[data-problems]', main).innerHTML = fixes.map((x) => `<p>${esc(x)}</p>`).join('');
    return refresh();
  }
  drawSummary();
}

function drawSummary() {
  const q = quote;
  $('[data-lines]', main).innerHTML = q.lines
    .map((l) => {
      const hit = bySku(l.sku);
      return `<li><span class="summary__img"><img src="${esc(hit?.colour.img || hit?.product.img || '')}" alt="" /><b>${l.qty}</b></span>
        <span><strong>${esc(hit?.product.name || l.category)}</strong><br><span class="fine">${esc(l.colour)}</span></span><span class="num">${fmt(l.price * l.qty)}</span></li>`;
    })
    .join('');
  const cmsg = $('[data-coupon-msg]', main);
  cmsg.textContent = q.coupon ? (q.coupon.valid ? `${q.coupon.code} applied.` : q.coupon.reason === 'min_subtotal' ? `${q.coupon.code} needs an order of ${fmt(q.coupon.min_subtotal)} or more.` : COUPON_REASON[q.coupon.reason] || 'That code can’t be used.') : '';
  $('[data-totals]', main).innerHTML = `
    <div><dt>Subtotal</dt><dd>${fmt(q.subtotal)}</dd></div>
    ${q.discount ? `<div><dt>Discount${q.coupon?.code ? ` (${esc(q.coupon.code)})` : ''}</dt><dd>−${fmt(q.discount)}</dd></div>` : ''}
    <div><dt>Shipping</dt><dd>${q.shipping ? fmt(q.shipping) : 'Free'}</dd></div>
    ${q.cod_fee ? `<div><dt>Cash on delivery fee</dt><dd>${fmt(q.cod_fee)}</dd></div>` : ''}
    <div class="summary__total"><dt>Total</dt><dd>${fmt(q.total)}</dd></div>`;

  const rules = getRulesFromQuote(q);
  $('[data-methods]', main).innerHTML = `
    <label class="choice"><input type="radio" name="method" value="razorpay" ${form.method === 'razorpay' ? 'checked' : ''} />
      <span><strong>Pay online</strong><br><span class="fine">UPI, cards, netbanking and wallets, through Razorpay</span></span></label>
    ${
      rules.codShown
        ? `<label class="choice${q.cod_available || form.method === 'cod' ? '' : ' is-off'}"><input type="radio" name="method" value="cod" ${form.method === 'cod' ? 'checked' : ''} ${q.cod_available || form.method === 'cod' ? '' : 'disabled'} />
      <span><strong>Cash on delivery</strong><br><span class="fine">${q.cod_available || form.method === 'cod' ? 'Pay when it arrives' : 'Not available for this order total'}</span></span></label>`
        : ''
    }`;

  const probs = (q.problems || []).filter((p) => p.kind === 'cod_limit' || p.kind === 'cod_off');
  const box = $('[data-problems]', main);
  if (probs.length) {
    box.hidden = false;
    box.innerHTML = '<p>Cash on delivery isn’t available for this order. Please choose to pay online.</p>';
  } else if (!box.textContent.includes('changed') && !box.textContent.includes('removed')) box.hidden = true;

  if (!pinCheck.serviceable) {
    box.hidden = false;
    box.innerHTML = `<p>We can’t deliver to PIN ${esc(pinCheck.pin)} yet. Please check it, or use another address.</p>`;
  } else if (form.method === 'cod' && !pinCheck.cod) {
    box.hidden = false;
    box.innerHTML = '<p>Cash on delivery isn’t available for this PIN code. Please choose to pay online.</p>';
  }
  const btn = $('[data-pay]', main);
  btn.disabled = probs.length > 0 || paying || !pinCheck.serviceable || (form.method === 'cod' && !pinCheck.cod);
  btn.textContent = !LIVE ? `Place sample order · ${fmt(q.total)}` : form.method === 'cod' ? `Place order · ${fmt(q.total)}` : `Pay ${fmt(q.total)}`;
}

// whether to show the cash option at all (it's hidden when the store has it switched off)
function getRulesFromQuote(q) {
  return { codShown: q.cod_available || q.method === 'cod' || (!LIVE ? getState().settings.codEnabled : rulesCache?.cod_enabled) };
}
let rulesCache = null;
if (LIVE) supabase.rpc('store_rules').then(({ data }) => {
  rulesCache = data;
  if (quote) drawSummary();
});

function validate() {
  const f = $('[data-form]', main);
  $$('[aria-invalid]', f).forEach((x) => x.removeAttribute('aria-invalid'));
  const email = f.email.value.trim();
  const phone = f.phone.value.replace(/\D/g, '');
  const a = currentAddress();
  const errs = [
    [!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email), 'email', 'Enter a valid email address.'],
    [!/^[6-9][0-9]{9}$/.test(phone), 'phone', 'Enter a 10-digit Indian mobile number.'],
  ];
  if (!form.addressId) {
    errs.push(
      [!a.full_name, 'full_name', 'Enter the name of the person receiving it.'],
      [!a.line1, 'line1', 'Enter the house and street.'],
      [!validPin(a.pin), 'pin', 'Enter a 6-digit PIN code.'],
      [!a.city, 'city', 'Enter the city.'],
      [!a.state, 'state', 'Choose the state.'],
    );
  }
  const bad = errs.find(([c]) => c);
  if (bad) {
    f[bad[1]].setAttribute('aria-invalid', 'true');
    f[bad[1]].focus();
    showProblem(bad[2]);
    return null;
  }
  return { contact: { email, phone: '+91' + phone, note: f.note.value.trim() }, address: a };
}

function showProblem(msg) {
  const box = $('[data-problems]', main);
  box.hidden = false;
  box.innerHTML = `<p>${esc(msg)}</p>`;
}

function setPaying(on, label) {
  paying = on;
  const btn = $('[data-pay]', main);
  btn.disabled = on;
  if (label) btn.textContent = label;
}

const ERRORS = {
  bad_email: 'Enter a valid email address.',
  bad_phone: 'Enter a 10-digit Indian mobile number.',
  bad_address: 'Please complete the delivery address.',
  coupon: 'That discount code can’t be used. Remove it to continue.',
  payments_not_configured: 'Online payment isn’t switched on yet.',
  payment_provider: 'The payment service didn’t respond. Nothing was charged. Please try again in a moment.',
  network: 'Could not reach the server. Check your connection and try again.',
  zero_total: 'This order has nothing to pay.',
  too_many_requests: 'Too many attempts from this connection. Please wait a few minutes and try again.',
};

async function pay() {
  if (paying || !quote) return;
  const v = validate();
  if (!v) return;
  $('[data-problems]', main).hidden = true;
  const items = cart.items.map((i) => ({ sku: i.sku, qty: i.qty }));

  if (!LIVE) return placeSample(v);

  setPaying(true, 'One moment…');
  const r = await callFunction('checkout', { items, coupon: form.coupon || null, method: form.method, ...v, resume: readPending() });
  if (!r.ok) {
    setPaying(false);
    if (r.body.error === 'cart') {
      quote = r.body.quote;
      await refresh();
      return showProblem('Something in your bag changed. We’ve updated it. Please check and try again.');
    }
    drawSummary();
    return showProblem(ERRORS[r.body.error] || 'Your order couldn’t be placed. Please try again.');
  }
  maybeSaveAddress(v);

  if (r.body.method === 'cod') return finish(r.body);
  savePending({ order_id: r.body.order_id, access_token: r.body.access_token });
  openRazorpay(r.body);
}

function loadRazorpay() {
  if (window.Razorpay) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://checkout.razorpay.com/v1/checkout.js';
    s.onload = resolve;
    s.onerror = () => reject(new Error('razorpay_script'));
    document.head.appendChild(s);
  });
}

async function openRazorpay(o) {
  try {
    await loadRazorpay();
  } catch (e) {
    setPaying(false);
    drawSummary();
    return showProblem('The payment window couldn’t load. Check your connection, or turn off any blocker for checkout.razorpay.com, then try again.');
  }
  const rp = new window.Razorpay({
    ...o.razorpay,
    theme: { color: '#4a7048' },
    handler: async (resp) => {
      setPaying(true, 'Confirming payment…');
      const v = await callFunction('payment-verify', resp);
      // Even if this check fails (connection dropped), Razorpay's webhook will confirm the payment.
      finish(o, v.ok);
    },
    modal: {
      ondismiss: () => {
        setPaying(false);
        drawSummary();
        showProblem('Payment not completed. Your items are held for 15 minutes. You can try again.');
      },
    },
  });
  rp.on('payment.failed', (resp) => {
    showProblem(`Payment failed: ${resp?.error?.description || 'please try another method'}. You can try again.`);
  });
  rp.open();
}

function finish(o, confirmed = true) {
  clearPending();
  cart.clear();
  try {
    localStorage.setItem('vertu.last-order', JSON.stringify({ id: o.order_id, t: o.access_token }));
  } catch (_) {
    /* optional */
  }
  location.href = `../order/?id=${encodeURIComponent(o.order_id)}&t=${encodeURIComponent(o.access_token)}${confirmed ? '' : '&check=1'}`;
}

async function maybeSaveAddress(v) {
  const f = $('[data-form]', main);
  if (!customer.user || form.addressId || !f.save_address?.checked) return;
  await supabase.from('addresses').insert({ ...v.address, phone: v.contact.phone });
}

function placeSample(v) {
  const q = quote;
  let id;
  update((s) => {
    const max = Math.max(10427, ...s.orders.map((o) => Number(String(o.id).replace(/\D/g, '')) || 0));
    id = `VRT-${max + 1}`;
    for (const l of q.lines) {
      const p = s.products.find((x) => x.id === l.sku);
      if (p) p.stock = Math.max(0, p.stock - l.qty);
    }
    if (q.coupon?.valid) {
      const c = s.coupons.find((x) => x.code === q.coupon.code);
      if (c) c.used_count = (c.used_count || 0) + 1;
    }
    s.orders.unshift({
      id,
      createdAt: Date.now(),
      status: 'Pending',
      customer: { name: v.address.full_name, email: v.contact.email, phone: v.contact.phone, address: [v.address.line1, v.address.line2].filter(Boolean).join(', '), city: v.address.city, state: v.address.state, pin: v.address.pin },
      lines: q.lines.map(({ sku, category, colour, price, qty }) => ({ sku, category, colour, price, qty })),
      note: v.contact.note,
      subtotal: q.subtotal, discount: q.discount, shipping: q.shipping, codFee: q.cod_fee, total: q.total, coupon: q.coupon?.valid ? q.coupon.code : null,
      paymentMethod: form.method === 'cod' ? 'cod' : 'manual', paymentStatus: form.method === 'cod' ? 'cod' : 'paid', refunded: 0,
    });
  });
  finish({ order_id: id, access_token: 'sample' });
}

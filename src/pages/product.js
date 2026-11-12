import '../styles.css';
import '../pages.css';
import { PRODUCTS, DETAIL_SHOTS, fmt, productHref } from '../data.js';
import { cart, toast } from '../cart.js';
import { mountChrome } from '../chrome.js';
import { customer, accountsEnabled } from '../customer.js';
import { LIVE, supabase } from '../lib/supabase.js';
import { liveEstimate, validPin } from '../delivery.js';
import { esc, $, $$, wishButton, bindWishButtons, tile } from './ui.js';

const { drawer } = mountChrome();
import { legalInfo } from '../legal/info.js';
const legal = await legalInfo().catch(() => null);
const main = $('#main');
const params = new URLSearchParams(location.search);
const p = PRODUCTS[params.get('c')];

if (!p) {
  document.title = 'Not found | VERTU';
  main.innerHTML = `<div class="empty-state"><h1 class="page-title">We couldn’t find that bag.</h1>
    <p>It may have moved. Everything we make is in the shop.</p><a class="btn btn--ink" href="../shop/">Go to the shop</a></div>`;
} else {
  render();
}

function render() {
  const want = (params.get('colour') || '').toLowerCase();
  let ci = p.colours.findIndex((c) => c.name.toLowerCase() === want);
  if (ci < 0) ci = Math.max(0, p.colours.findIndex((c) => c.stock > 0));
  const state = { ci, qty: 1, shot: 0 };
  const specs = Object.entries(p.details.specs || {}).filter(([, v]) => String(v || '').trim());
  const features = (p.details.features || []).filter(Boolean);
  const others = Object.values(PRODUCTS).filter((x) => x.id !== p.id);

  main.innerHTML = `
    <nav class="crumbs" aria-label="Breadcrumb"><a href="../shop/">Shop</a><span aria-hidden="true">/</span><a href="../shop/?c=${p.id}">${esc(p.collection)}</a><span aria-hidden="true">/</span><span data-crumb aria-current="page"></span></nav>
    <div class="pdp">
      <section class="gallery" aria-label="Photos">
        <div class="gallery__main"><img data-main alt="" /></div>
        <div class="gallery__thumbs" data-thumbs></div>
      </section>
      <section class="pdp__info" aria-labelledby="pdp-name">
        <h1 class="pdp__name" id="pdp-name">${esc(p.name)}</h1>
        <p class="pdp__price" data-price></p>
        <p class="pdp__mrp fine" data-mrp></p>
        <p class="pdp__stock" data-stock aria-live="polite"></p>
        <p class="pdp__desc" data-desc></p>
        <fieldset class="swatches"><legend>Colour: <span data-colour-name></span></legend><div class="swatches__row" role="radiogroup" data-swatches></div></fieldset>
        <div class="pdp__actions" data-buy-row>
          <div class="qty qty--lg" role="group" aria-label="Quantity">
            <button type="button" data-q="-1" aria-label="Decrease quantity">&minus;</button><output data-qty aria-live="polite">1</output><button type="button" data-q="1" aria-label="Increase quantity">+</button>
          </div>
          <button type="button" class="btn btn--accent" data-add>Add to bag</button>
          <span data-wish-slot></span>
        </div>
        <button type="button" class="text-link pdp__buynow" data-buynow>Buy now</button>
        <form class="notify" data-notify hidden novalidate>
          <div class="notify__ask" data-notify-ask>
            <p>Sold out in this colour</p>
            <small>Leave your email and we’ll write once when it’s back. Nothing else.</small>
            <div class="inline"><input class="input" type="email" name="email" autocomplete="email" placeholder="you@example.com" aria-label="Email for back-in-stock alert" required /><button class="btn btn--ink" type="submit">Notify me</button></div>
            <p class="err" data-notify-err role="alert"></p>
          </div>
          <p data-notify-done role="status" hidden></p>
        </form>
        <form class="deliver" data-deliver novalidate>
          <label for="pin" style="font-weight:500">Check delivery</label>
          <div class="inline"><input class="input" id="pin" inputmode="numeric" autocomplete="postal-code" maxlength="6" placeholder="6-digit PIN code" /><button class="btn btn--ghost" type="submit">Check</button></div>
          <p class="deliver__out" data-deliver-out aria-live="polite"></p>
        </form>
        <div class="acc">
          ${features.length ? `<details open><summary>Design details</summary><div class="acc__body"><ul>${features.map((f) => `<li>${esc(f)}</li>`).join('')}</ul></div></details>` : ''}
          ${specs.length ? `<details><summary>Specifications</summary><div class="acc__body"><dl class="specs">${specs.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl></div></details>` : ''}
          ${p.details.care ? `<details><summary>Care</summary><div class="acc__body"><p>${esc(p.details.care)}</p></div></details>` : ''}
          <details><summary>Product information</summary><div class="acc__body"><dl class="specs" data-decl></dl></div></details>
          <details><summary>Questions</summary><div class="acc__body"><p>Write to <a class="text-link" href="mailto:contact.shopvertu@gmail.com">contact.shopvertu@gmail.com</a> and a person will reply.</p></div></details>
        </div>
      </section>
    </div>
    <section class="related" aria-labelledby="rel-h"><h2 id="rel-h">You might also like</h2>
      <div class="tiles">${others.map((o) => { const i = Math.max(0, o.colours.findIndex((c) => c.stock > 0)); return tile({ product: o, colour: o.colours[i] }); }).join('')}</div>
    </section>`;

  bindWishButtons(main);
  const mainImg = $('[data-main]', main);

  const shots = () => {
    const c = p.colours[state.ci];
    return [{ src: c.img || p.img, alt: `${p.name} in ${c.name}` }, ...DETAIL_SHOTS];
  };
  const showShot = (i, animate = true) => {
    const s = shots()[i];
    state.shot = i;
    const set = () => {
      mainImg.src = s.src;
      mainImg.alt = s.alt;
      mainImg.classList.remove('is-swapping');
    };
    if (animate && mainImg.getAttribute('src') && mainImg.getAttribute('src') !== s.src) {
      mainImg.classList.add('is-swapping');
      setTimeout(set, 220);
    } else set();
    $$('[data-thumbs] button', main).forEach((b, k) => b.setAttribute('aria-current', String(k === i)));
  };

  function sync() {
    const c = p.colours[state.ci];
    const sold = c.stock <= 0;
    state.qty = Math.min(Math.max(1, state.qty), Math.max(1, Math.min(9, c.stock)));
    document.title = `${c.name} ${p.name} | VERTU`;
    document.querySelector('meta[name=description]').setAttribute('content', `${c.name} ${p.name} by VERTU, ${fmt(c.price)}. ${p.description}`.slice(0, 160));
    $('[data-crumb]', main).textContent = `${c.name} ${p.name}`;
    $('[data-price]', main).textContent = fmt(c.price);
    $('[data-mrp]', main).textContent = c.mrp > c.price ? `MRP ${fmt(c.mrp)} (inclusive of all taxes)` : 'MRP, inclusive of all taxes';
    const d = p.declarations || {};
    const rows = [
      ['Generic name', d.generic_name], ['Net quantity', d.net_quantity], ['MRP', `${fmt(c.mrp)} (inclusive of all taxes)`],
      ['Country of origin', d.country_of_origin], ['Manufactured or packed by', d.maker || legal?.name], ['Month and year of manufacture', d.made_on],
      ['Dimensions', (p.details.specs || {}).Dimensions], ['Sold by', legal ? `${legal.name}${legal.address ? `, ${legal.address}` : ''}` : ''],
      ['Customer care', legal ? `${legal.care_email}${legal.care_phone ? `, ${legal.care_phone}` : ''}` : ''],
    ].filter(([, v]) => v && String(v).trim());
    $('[data-decl]', main).innerHTML = rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('');
    const st = $('[data-stock]', main);
    st.textContent = sold ? 'Sold out in this colour' : c.stock <= 5 ? `Only ${c.stock} left` : 'In stock';
    st.classList.toggle('is-low', !sold && c.stock <= 5);
    $('[data-desc]', main).textContent = c.description || p.description;
    $('[data-colour-name]', main).textContent = c.name;
    $('[data-qty]', main).textContent = String(state.qty);
    $('[data-swatches]', main).innerHTML = p.colours
      .map(
        (x, i) => `<button type="button" class="swatch${x.stock <= 0 ? ' is-sold' : ''}" role="radio" aria-checked="${i === state.ci}" tabindex="${i === state.ci ? 0 : -1}"
          aria-label="${esc(x.name)}${x.stock <= 0 ? ', sold out' : ''}" style="--c:${esc(x.hex)}" data-i="${i}"></button>`,
      )
      .join('');
    $('[data-wish-slot]', main).innerHTML = wishButton(c.sku, `${c.name} ${p.name}`);
    const add = $('[data-add]', main);
    add.disabled = sold;
    add.textContent = sold ? 'Sold out' : 'Add to bag';
    $('[data-buy-row] .qty', main).hidden = sold;
    $('[data-buynow]', main).hidden = sold;
    const notify = $('[data-notify]', main);
    notify.hidden = !sold;
    $('[data-notify-err]', main).textContent = '';
    $('[data-notify-ask]', main).hidden = false;
    $('[data-notify-done]', main).hidden = true;
    notify.querySelector('button').disabled = false;
    if (sold && customer.user?.email) notify.email.value = customer.user.email;
    $('[data-thumbs]', main).innerHTML = shots()
      .map((s, i) => `<button type="button" aria-label="Photo ${i + 1} of ${shots().length}" aria-current="${i === state.shot}"><img src="${esc(s.src)}" alt="" loading="lazy" /></button>`)
      .join('');
    showShot(state.shot);
    const url = new URL(location.href);
    url.searchParams.set('colour', c.name.toLowerCase());
    history.replaceState(null, '', url);
    structuredData(c);
  }

  $('[data-swatches]', main).addEventListener('click', (e) => {
    const b = e.target.closest('.swatch');
    if (!b) return;
    state.ci = Number(b.dataset.i);
    state.qty = 1;
    state.shot = 0;
    sync();
    $(`[data-swatches] [data-i="${state.ci}"]`, main).focus();
  });
  $('[data-swatches]', main).addEventListener('keydown', (e) => {
    if (!['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp'].includes(e.key)) return;
    e.preventDefault();
    const n = p.colours.length;
    state.ci = (state.ci + (e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1) + n) % n;
    state.qty = 1;
    state.shot = 0;
    sync();
    $(`[data-swatches] [data-i="${state.ci}"]`, main).focus();
  });
  $('[data-thumbs]', main).addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (b) showShot([...b.parentNode.children].indexOf(b));
  });
  $$('[data-q]', main).forEach((b) =>
    b.addEventListener('click', () => {
      const c = p.colours[state.ci];
      state.qty = Math.max(1, Math.min(9, c.stock, state.qty + Number(b.dataset.q)));
      $('[data-qty]', main).textContent = String(state.qty);
    }),
  );
  const addToBag = () => {
    const c = p.colours[state.ci];
    if (cart.add(c.sku, state.qty)) {
      toast(`${c.name} ${p.name} added to your bag`);
      return true;
    }
    toast(c.stock <= 0 ? 'That colour is sold out' : 'Your bag already has all we have in this colour');
    return false;
  };
  $('[data-add]', main).addEventListener('click', addToBag);
  $('[data-buynow]', main).addEventListener('click', () => {
    addToBag();
    if (cart.count) drawer.open();
  });

  $('[data-notify]', main).addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.currentTarget;
    const err = $('[data-notify-err]', main);
    const email = f.email.value.trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return (err.textContent = 'Enter a valid email address.');
    const c = p.colours[state.ci];
    const done = (msg) => {
      $('[data-notify-ask]', main).hidden = true;
      const d = $('[data-notify-done]', main);
      d.hidden = false;
      d.textContent = msg;
    };
    if (!LIVE) return done(`Thanks. We’ll email ${email} when ${c.name} is back. (Sample mode: nothing is actually sent.)`);
    f.querySelector('button').disabled = true;
    const { error } = await supabase.from('stock_alerts').insert({ sku: c.sku, email, user_id: customer.user?.id ?? null });
    if (error && error.code !== '23505') {
      f.querySelector('button').disabled = false;
      return (err.textContent = 'That didn’t go through. Please try again.');
    }
    done(`Thanks. We’ll email ${email} once, when ${c.name} is back.`);
  });

  const pinIn = $('#pin', main);
  const out = $('[data-deliver-out]', main);
  const showEstimate = async (pin) => {
    if (!validPin(pin)) return (out.innerHTML = 'Enter a 6-digit PIN code.');
    out.textContent = 'Checking…';
    const est = await liveEstimate(pin);
    out.innerHTML = !est
      ? 'Enter a 6-digit PIN code.'
      : !est.serviceable
        ? `We can’t deliver to <strong>${esc(pin)}</strong> yet. Write to us and we’ll find a way.`
        : `Estimated delivery to <strong>${esc(pin)}</strong>: <strong>${est.label}</strong>.${est.cod ? '' : ' Online payment only for this PIN.'}`;
    if (est) {
      try {
        localStorage.setItem('vertu.pin', pin);
      } catch (_) {
        /* optional */
      }
    }
  };
  try {
    const saved = localStorage.getItem('vertu.pin');
    if (saved && validPin(saved)) (pinIn.value = saved), showEstimate(saved);
  } catch (_) {
    /* optional */
  }
  $('[data-deliver]', main).addEventListener('submit', (e) => {
    e.preventDefault();
    showEstimate(pinIn.value.replace(/\D/g, ''));
  });

  sync();
  if (accountsEnabled) customer.onChange(() => sync());
}

function structuredData(c) {
  let el = document.getElementById('ld-product');
  if (!el) {
    el = document.createElement('script');
    el.type = 'application/ld+json';
    el.id = 'ld-product';
    document.head.appendChild(el);
  }
  el.textContent = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'ProductGroup',
    name: p.name,
    brand: { '@type': 'Brand', name: 'VERTU' },
    description: p.description,
    productGroupID: p.id,
    variesBy: ['https://schema.org/color'],
    hasVariant: p.colours.map((x) => ({
      '@type': 'Product',
      sku: x.sku,
      name: `${x.name} ${p.name}`,
      color: x.name,
      image: new URL(x.img || p.img, location.href).href,
      offers: {
        '@type': 'Offer',
        price: x.price,
        priceCurrency: 'INR',
        availability: x.stock > 0 ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
        url: new URL(productHref(p.id, x.name, '../'), location.href).href,
      },
    })),
  });
}

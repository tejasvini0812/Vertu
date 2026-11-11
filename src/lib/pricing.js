/**
 * The checkout pricing rules in JavaScript, mirroring public.price_cart() in the database.
 * Used for instant feedback and for sample mode. In live mode the database's answer is what counts:
 * tests/pricing-parity.test.mjs checks both give the same result.
 *
 * products: Map sku -> { id, category, colour, price, stock, status, image }
 * settings: { shippingFee, freeShippingOver, codEnabled, codFee, codMax }
 * coupons:  [{ code, kind: 'percent'|'amount', value, min_subtotal, starts_at, ends_at, max_uses, used_count, active }]
 */
export function priceCart(items, coupon, method, { products, settings, coupons = [], now = new Date() }) {
  const problems = [];
  if (!Array.isArray(items) || !items.length) return { problems: [{ kind: 'empty' }] };
  if (items.length > 20) return { problems: [{ kind: 'too_many_lines' }] };
  if (!['razorpay', 'cod'].includes(method)) return { problems: [{ kind: 'bad_method' }] };
  const s = { shippingFee: 0, freeShippingOver: 0, codEnabled: false, codFee: 0, codMax: 5000, ...settings };
  const lines = [];
  let subtotal = 0;
  for (const it of items) {
    const p = products.get(it.sku);
    const qty = /^[0-9]{1,2}$/.test(String(it.qty)) ? Number(it.qty) : 0;
    if (!p || p.status !== 'active') {
      problems.push({ kind: 'unavailable', sku: it.sku });
      continue;
    }
    if (qty < 1 || qty > 9) {
      problems.push({ kind: 'bad_qty', sku: p.id });
      continue;
    }
    if (p.stock < qty) problems.push({ kind: 'insufficient', sku: p.id, available: p.stock });
    if (lines.some((l) => l.sku === p.id)) {
      problems.push({ kind: 'duplicate', sku: p.id });
      continue;
    }
    lines.push({ sku: p.id, category: p.category, colour: p.colour, price: p.price, qty, image: p.image });
    subtotal += p.price * qty;
  }

  let discount = 0;
  let c = null;
  const code = String(coupon || '').trim().toUpperCase();
  if (code) {
    const k = coupons.find((x) => x.code === code);
    const t = +now;
    c = { code, valid: false };
    if (!k || !k.active) c.reason = 'not_found';
    else if (k.starts_at && t < +new Date(k.starts_at)) c.reason = 'not_started';
    else if (k.ends_at && t > +new Date(k.ends_at)) c.reason = 'expired';
    else if (k.max_uses != null && k.used_count >= k.max_uses) c.reason = 'used_up';
    else if (subtotal < (k.min_subtotal || 0)) Object.assign(c, { reason: 'min_subtotal', min_subtotal: k.min_subtotal });
    else {
      discount = k.kind === 'percent' ? Math.floor((subtotal * k.value) / 100) : Math.min(k.value, subtotal);
      c = { code, valid: true, kind: k.kind, value: k.value };
    }
  }

  const shipping = s.freeShippingOver > 0 && subtotal - discount >= s.freeShippingOver ? 0 : s.shippingFee;
  let codFee = 0;
  if (method === 'cod') {
    if (!s.codEnabled) problems.push({ kind: 'cod_off' });
    else {
      codFee = s.codFee;
      if (subtotal - discount + shipping + codFee > s.codMax) problems.push({ kind: 'cod_limit', cod_max: s.codMax });
    }
  }
  return {
    lines, subtotal, discount, shipping, cod_fee: codFee, total: subtotal - discount + shipping + codFee,
    coupon: c, method, cod_available: s.codEnabled && subtotal - discount + shipping + s.codFee <= s.codMax, problems,
  };
}

/** Shopper-facing wording for quote problems and coupon reasons. */
export const COUPON_REASON = {
  not_found: 'That code isn’t valid.',
  not_started: 'That code isn’t active yet.',
  expired: 'That code has expired.',
  used_up: 'That code has been fully used.',
  min_subtotal: 'Add a little more to use that code.',
};

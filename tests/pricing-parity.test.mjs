// The browser's pricing (src/lib/pricing.js) must agree with the database's (public.price_cart).
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { makeDb, serviceRpc } from '../supabase/tests/db.mjs';
import { priceCart } from '../src/lib/pricing.js';

let db, rpc;
before(async () => {
  db = await makeDb();
  rpc = serviceRpc(db);
  await db.exec(`update settings set shipping_fee = 99, free_shipping_over = 3000, cod_enabled = true, cod_fee = 49, cod_max = 4000;
    update products set status = 'draft' where id = 'VRT-LP-FOR';
    insert into coupons (code, kind, value, min_subtotal) values ('TEN','percent',10,2000), ('FLAT250','amount',250,0);
    insert into coupons (code, kind, value, max_uses, used_count) values ('GONE','amount',100,1,1);
    insert into coupons (code, kind, value, ends_at, starts_at) values ('OLD','amount',100, now() - interval '1 day', now() - interval '2 days');`);
});

async function context() {
  const p = (await db.query('select * from products')).rows;
  const s = (await db.query('select * from settings')).rows[0];
  const c = (await db.query('select * from coupons')).rows;
  return {
    products: new Map(p.map((x) => [x.id, x])),
    settings: { shippingFee: s.shipping_fee, freeShippingOver: s.free_shipping_over, codEnabled: s.cod_enabled, codFee: s.cod_fee, codMax: s.cod_max },
    coupons: c,
  };
}

const cases = [
  [[{ sku: 'VRT-SL-COB', qty: 1 }], null, 'razorpay'],
  [[{ sku: 'VRT-SL-COB', qty: 2 }], null, 'razorpay'],
  [[{ sku: 'VRT-SL-COB', qty: 2 }], 'ten', 'razorpay'],
  [[{ sku: 'VRT-SL-COB', qty: 1 }], 'TEN', 'razorpay'],
  [[{ sku: 'VRT-SL-COB', qty: 1 }], 'FLAT250', 'cod'],
  [[{ sku: 'VRT-LP-CRI', qty: 2 }], null, 'cod'],
  [[{ sku: 'VRT-SL-MUS', qty: 1 }, { sku: 'VRT-LP-FOR', qty: 1 }, { sku: 'NOPE', qty: 1 }], null, 'razorpay'],
  [[{ sku: 'VRT-MS-NAV', qty: 0 }, { sku: 'VRT-MS-TEA', qty: 1 }, { sku: 'VRT-MS-TEA', qty: 1 }], null, 'razorpay'],
  [[{ sku: 'VRT-SL-COB', qty: 1 }], 'GONE', 'razorpay'],
  [[{ sku: 'VRT-SL-COB', qty: 1 }], 'OLD', 'razorpay'],
  [[{ sku: 'VRT-SL-COB', qty: 1 }], 'MISSING', 'razorpay'],
  [[], null, 'razorpay'],
];

for (const [items, coupon, method] of cases) {
  test(`same answer: ${JSON.stringify(items)} ${coupon} ${method}`, async () => {
    const sql = await rpc('price_cart', { p_items: items, p_coupon: coupon, p_method: method });
    const js = priceCart(items, coupon, method, await context());
    assert.deepEqual(JSON.parse(JSON.stringify(js)), sql);
  });
}

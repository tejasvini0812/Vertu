import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diff, apply, replaceImages, orderFromRow } from '../src/lib/sync.js';
import { seed } from '../src/seed.js';

const base = () => seed(Date.parse('2026-11-12T06:00:00Z'));
const clone = (x) => structuredClone(x);

test('no change, no writes', () => {
  const s = base();
  assert.deepEqual(diff(s, clone(s)), []);
});

test('price and stock edit becomes one update with only those fields', () => {
  const a = base();
  const b = clone(a);
  b.products[0].price = 1899;
  b.products[0].stock = 20;
  assert.deepEqual(diff(a, b), [{ table: 'products', type: 'update', id: a.products[0].id, values: { price: 1899, stock: 20 } }]);
});

test('add, remove, order status, content and settings', () => {
  const a = base();
  const b = clone(a);
  b.products.push({ ...b.products[0], id: 'VRT-SL-TAN', colour: 'Tan' });
  b.products.splice(1, 1);
  b.orders[0].status = 'Delivered';
  b.content.hero.headline = 'New';
  b.settings.lowStock = 3;
  const ops = diff(a, b);
  assert.equal(ops.find((o) => o.type === 'insert').values.colour, 'Tan');
  assert.equal(ops.find((o) => o.type === 'insert').values.sort, b.products.length - 1);
  assert.equal(ops.find((o) => o.type === 'delete').id, a.products[1].id);
  assert.deepEqual(ops.find((o) => o.table === 'orders').values, { status: 'Delivered' });
  assert.equal(ops.find((o) => o.table === 'site_content').values.published.hero.headline, 'New');
  assert.equal('publishedAt' in ops.find((o) => o.table === 'site_content').values.published, false);
  assert.deepEqual(ops.find((o) => o.table === 'settings').values, { low_stock: 3 });
});

test('orders are never inserted from the browser', () => {
  const a = base();
  const b = clone(a);
  b.orders.unshift({ ...b.orders[0], id: 'VRT-99999' });
  assert.equal(diff(a, b).filter((o) => o.table === 'orders').length, 0);
});

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

test('nested data URLs are uploaded and replaced', async () => {
  const out = await replaceImages({ a: [{ image: PNG }, { image: 'asset:x' }], b: PNG }, async () => 'https://cdn/x.png');
  assert.deepEqual(out, { a: [{ image: 'https://cdn/x.png' }, { image: 'asset:x' }], b: 'https://cdn/x.png' });
});

function fakeClient({ deny = false } = {}) {
  const calls = [];
  const builder = (table) => {
    const q = { table };
    const run = () => {
      calls.push(q);
      return Promise.resolve({ data: deny ? [] : [{ id: q.id ?? 'x' }], error: null });
    };
    const chain = {
      insert: (v) => ((q.op = 'insert'), (q.values = v), chain),
      update: (v) => ((q.op = 'update'), (q.values = v), chain),
      delete: () => ((q.op = 'delete'), chain),
      eq: (k, v) => ((q.id = v), chain),
      select: () => ({ then: (r, j) => run().then(r, j) }),
    };
    return chain;
  };
  return {
    calls,
    from: builder,
    storage: {
      from: () => ({
        upload: async (path, blob) => (calls.push({ upload: path, type: blob.type, size: blob.size }), { error: null }),
        getPublicUrl: (path) => ({ data: { publicUrl: `https://cdn.test/${path}` } }),
      }),
    },
  };
}

test('apply uploads the image before writing the product', async () => {
  const c = fakeClient();
  const ops = [{ table: 'products', type: 'update', id: 'VRT-SL-CRI', values: { image: PNG } }];
  await apply(c, ops);
  assert.match(c.calls[0].upload, /^products\/\d+-.+\.png$/);
  assert.equal(c.calls[0].type, 'image/png');
  assert.match(c.calls[1].values.image, /^https:\/\/cdn\.test\/products\//);
  assert.equal(ops[0].values.image, c.calls[1].values.image);
});

test('a write that changes no rows is reported as not allowed', async () => {
  await assert.rejects(apply(fakeClient({ deny: true }), [{ table: 'products', type: 'update', id: 'X', values: { price: 1 } }]), (e) => e.message === 'not-allowed' && e.code === '42501');
});

test('order rows map to the admin shape with items in order', () => {
  const o = orderFromRow({
    id: 'VRT-10500', created_at: '2026-11-12T06:00:00Z', status: 'Pending', customer_name: 'A', customer_email: 'a@b.c',
    customer_phone: '', ship_address: '1 Road', ship_city: 'Pune', ship_state: 'MH', ship_pin: '411001', note: null,
    order_items: [{ id: 2, sku: 'B', category: 'sling', colour: 'Black', price: 10, qty: 1 }, { id: 1, sku: 'A', category: 'sling', colour: 'Crimson', price: 20, qty: 2 }],
  });
  assert.deepEqual(o.lines.map((l) => l.sku), ['A', 'B']);
  assert.equal(o.customer.city, 'Pune');
  assert.equal(o.note, '');
});

test('collection details edits become a categories update', () => {
  const a = base();
  const b = clone(a);
  b.categories[0].details.specs.Material = 'Cotton canvas';
  b.categories[0].description = 'New copy';
  const ops = diff(a, b);
  assert.equal(ops.length, 1);
  assert.equal(ops[0].table, 'categories');
  assert.equal(ops[0].id, 'sling');
  assert.equal(ops[0].values.details.specs.Material, 'Cotton canvas');
  assert.equal(ops[0].values.description, 'New copy');
});

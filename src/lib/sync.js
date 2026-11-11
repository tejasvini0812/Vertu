/**
 * Pure mapping + diffing between the app's state shape and the database.
 * No browser or bundler imports here, so it runs under plain Node for tests.
 *
 * The admin edits a copy of the state; `diff(prev, next)` turns that edit into the smallest
 * set of database writes, and `apply(client, ops)` performs them (uploading any new images first).
 */

export const PRODUCT_FIELDS = ['category', 'colour', 'hex', 'price', 'stock', 'status', 'image', 'description'];

export const productFromRow = (r) => ({
  id: r.id,
  category: r.category,
  colour: r.colour,
  hex: r.hex,
  price: r.price,
  stock: r.stock,
  status: r.status,
  image: r.image,
  description: r.description,
});

export const orderFromRow = (r) => ({
  id: r.id,
  createdAt: Date.parse(r.created_at),
  status: r.status,
  customer: {
    name: r.customer_name,
    email: r.customer_email,
    phone: r.customer_phone,
    address: r.ship_address,
    city: r.ship_city,
    state: r.ship_state,
    pin: r.ship_pin,
  },
  lines: (r.order_items || [])
    .sort((a, b) => a.id - b.id)
    .map((l) => ({ sku: l.sku, category: l.category, colour: l.colour, price: l.price, qty: l.qty })),
  note: r.note || '',
});

export const categoryFromRow = (r) => ({
  id: r.id,
  name: r.name,
  code: r.code,
  unit: r.unit,
  description: r.description || '',
  details: r.details || {},
});

export const contentFromRow = (r) => ({ ...r.published, publishedAt: r.published_at ? Date.parse(r.published_at) : null });

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export function diff(prev, next) {
  const ops = [];

  const before = new Map(prev.products.map((p) => [p.id, p]));
  const after = new Map(next.products.map((p, i) => [p.id, { p, i }]));
  for (const [id, { p, i }] of after) {
    const old = before.get(id);
    if (!old) {
      const values = { id, sort: i };
      PRODUCT_FIELDS.forEach((f) => (values[f] = p[f]));
      ops.push({ table: 'products', type: 'insert', id, values });
    } else {
      const values = {};
      PRODUCT_FIELDS.forEach((f) => !same(old[f], p[f]) && (values[f] = p[f]));
      if (Object.keys(values).length) ops.push({ table: 'products', type: 'update', id, values });
    }
  }
  for (const id of before.keys()) if (!after.has(id)) ops.push({ table: 'products', type: 'delete', id });

  const oldOrders = new Map(prev.orders.map((o) => [o.id, o]));
  for (const o of next.orders) {
    const old = oldOrders.get(o.id);
    if (!old) continue; // orders are created by checkout on the server, never here
    const values = {};
    if (old.status !== o.status) values.status = o.status;
    if ((old.note || '') !== (o.note || '')) values.note = o.note || '';
    if (Object.keys(values).length) ops.push({ table: 'orders', type: 'update', id: o.id, values });
  }

  const strip = ({ publishedAt, ...rest }) => rest;
  if (!same(strip(prev.content), strip(next.content))) {
    ops.push({
      table: 'site_content',
      type: 'update',
      id: 1,
      values: { published: strip(next.content), published_at: new Date(next.content.publishedAt || Date.now()).toISOString() },
    });
  }

  const oldCats = new Map((prev.categories || []).map((c) => [c.id, c]));
  for (const c of next.categories || []) {
    const old = oldCats.get(c.id);
    if (!old) continue; // collections are fixed; their details are editable
    const values = {};
    if ((old.description || '') !== (c.description || '')) values.description = c.description || '';
    if (!same(old.details || {}, c.details || {})) values.details = c.details || {};
    if (Object.keys(values).length) ops.push({ table: 'categories', type: 'update', id: c.id, values });
  }

  if (prev.settings.lowStock !== next.settings.lowStock) {
    ops.push({ table: 'settings', type: 'update', id: 1, values: { low_stock: next.settings.lowStock } });
  }
  return ops;
}

const isData = (v) => typeof v === 'string' && v.startsWith('data:image/');

/** Replace every data: URL inside `value` (deeply) using `upload`, returning the new value. */
export async function replaceImages(value, upload) {
  if (isData(value)) return upload(value);
  if (Array.isArray(value)) return Promise.all(value.map((v) => replaceImages(v, upload)));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = await replaceImages(v, upload);
    return out;
  }
  return value;
}

export function dataUrlToBlob(dataUrl) {
  const [head, b64] = dataUrl.split(',');
  const type = head.slice(5, head.indexOf(';'));
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}

export function makeUploader(client, bucket = 'media') {
  return async (dataUrl, folder = 'uploads') => {
    const blob = dataUrlToBlob(dataUrl);
    const ext = blob.type === 'image/png' ? 'png' : blob.type === 'image/webp' ? 'webp' : 'jpg';
    const rand = (globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2)).slice(0, 12);
    const path = `${folder}/${Date.now()}-${rand}.${ext}`;
    const { error } = await client.storage.from(bucket).upload(path, blob, {
      contentType: blob.type,
      cacheControl: '31536000',
      upsert: false,
    });
    if (error) throw Object.assign(new Error(error.message), { code: 'upload', cause: error });
    return client.storage.from(bucket).getPublicUrl(path).data.publicUrl;
  };
}

export class SyncError extends Error {
  constructor(message, code, cause) {
    super(message);
    this.code = code;
    this.cause = cause;
  }
}

/** Runs ops in order. Mutates op.values to hold uploaded image URLs. Throws SyncError on the first failure. */
export async function apply(client, ops) {
  const upload = makeUploader(client);
  for (const op of ops) {
    if (op.values) {
      const folder = op.table === 'products' ? 'products' : 'editorial';
      op.values = await replaceImages(op.values, (d) => upload(d, folder));
    }
    const t = client.from(op.table);
    let res;
    if (op.type === 'insert') res = await t.insert(op.values).select('id');
    else if (op.type === 'update') res = await t.update(op.values).eq('id', op.id).select('id');
    else res = await t.delete().eq('id', op.id).select('id');
    if (res.error) throw new SyncError(res.error.message, res.error.code, res.error);
    if (!res.data || res.data.length === 0) throw new SyncError('not-allowed', '42501');
  }
  return ops;
}

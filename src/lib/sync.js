/**
 * Pure mapping + diffing between the app's state shape and the database.
 * No browser or bundler imports here, so it runs under plain Node for tests.
 *
 * The admin edits a copy of the state; `diff(prev, next)` turns that edit into the smallest
 * set of database writes, and `apply(client, ops)` performs them (uploading any new images first).
 */

export const PRODUCT_FIELDS = ['category', 'colour', 'hex', 'price', 'stock', 'status', 'image', 'description', 'mrp'];

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
  mrp: r.mrp ?? null,
});

export const settingsFromRow = (r) => ({
  lowStock: r.low_stock,
  shippingFee: r.shipping_fee ?? 0,
  freeShippingOver: r.free_shipping_over ?? 0,
  codEnabled: !!r.cod_enabled,
  codFee: r.cod_fee ?? 0,
  codMax: r.cod_max ?? 5000,
  holdMinutes: r.hold_minutes ?? 15,
  notifyEmail: r.notify_email || '',
  abandonedCartEnabled: !!r.abandoned_cart_enabled,
  pickupLocation: r.pickup_location || 'Primary',
  pickupPin: r.pickup_pin || '',
  legalName: r.legal_name || '',
  gstin: r.gstin || '',
  gstRegistered: !!r.gst_registered,
  businessAddress: r.business_address || '',
  businessCity: r.business_city || '',
  businessState: r.business_state || '',
  businessPhone: r.business_phone || '',
  invoicePrefix: r.invoice_prefix || 'VRT',
  returnWindowDays: r.return_window_days ?? 7,
  registeredAddress: r.registered_address || '',
  careEmail: r.care_email || '',
  carePhone: r.care_phone || '',
  careHours: r.care_hours || '',
  grievanceName: r.grievance_name || '',
  grievanceTitle: r.grievance_title || 'Grievance Officer',
  grievanceEmail: r.grievance_email || '',
  grievancePhone: r.grievance_phone || '',
  dispatchDays: r.dispatch_days ?? 2,
  returnShippingFee: r.return_shipping_fee ?? 0,
  policiesUpdatedAt: r.policies_updated_at || '',
  darkPatternsAudit: r.dark_patterns_audit || {},
});
const SETTINGS_COLUMNS = {
  lowStock: 'low_stock',
  shippingFee: 'shipping_fee',
  freeShippingOver: 'free_shipping_over',
  codEnabled: 'cod_enabled',
  codFee: 'cod_fee',
  codMax: 'cod_max',
  holdMinutes: 'hold_minutes',
  notifyEmail: 'notify_email',
  abandonedCartEnabled: 'abandoned_cart_enabled',
  pickupLocation: 'pickup_location',
  pickupPin: 'pickup_pin',
  legalName: 'legal_name',
  gstin: 'gstin',
  gstRegistered: 'gst_registered',
  businessAddress: 'business_address',
  businessCity: 'business_city',
  businessState: 'business_state',
  businessPhone: 'business_phone',
  invoicePrefix: 'invoice_prefix',
  returnWindowDays: 'return_window_days',
  registeredAddress: 'registered_address',
  careEmail: 'care_email',
  carePhone: 'care_phone',
  careHours: 'care_hours',
  grievanceName: 'grievance_name',
  grievanceTitle: 'grievance_title',
  grievanceEmail: 'grievance_email',
  grievancePhone: 'grievance_phone',
  dispatchDays: 'dispatch_days',
  returnShippingFee: 'return_shipping_fee',
  policiesUpdatedAt: 'policies_updated_at',
  darkPatternsAudit: 'dark_patterns_audit',
};
// text settings whose empty value must be stored as NULL (they have format checks)
const NULLABLE = new Set(['notify_email', 'pickup_pin', 'gstin', 'business_phone', 'care_email', 'care_phone', 'grievance_email', 'grievance_phone', 'policies_updated_at']);
export const COUPON_FIELDS = ['kind', 'value', 'min_subtotal', 'starts_at', 'ends_at', 'max_uses', 'active', 'note'];

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
  subtotal: r.subtotal ?? null,
  discount: r.discount ?? 0,
  shipping: r.shipping ?? 0,
  codFee: r.cod_fee ?? 0,
  total: r.total ?? null,
  coupon: r.coupon_code || null,
  paymentMethod: r.payment_method || 'manual',
  paymentStatus: r.payment_status || 'paid',
  razorpayOrderId: r.razorpay_order_id || null,
  razorpayPaymentId: r.razorpay_payment_id || null,
  paidAt: r.paid_at ? Date.parse(r.paid_at) : null,
  refunded: r.refunded_amount ?? 0,
  flag: r.flag || null,
  courier: r.courier || '',
  trackingNumber: r.tracking_number || '',
  trackingUrl: r.tracking_url || '',
  awb: r.awb || '',
  shipmentId: r.shipment_id || '',
  labelUrl: r.label_url || '',
  shipStatus: r.ship_status || '',
  eta: r.eta || null,
  deliveredAt: r.delivered_at ? Date.parse(r.delivered_at) : null,
});

export const categoryFromRow = (r) => ({
  id: r.id,
  name: r.name,
  code: r.code,
  unit: r.unit,
  description: r.description || '',
  details: r.details || {},
  hsn: r.hsn || '4202',
  gstRate: r.gst_rate != null ? Number(r.gst_rate) : 18,
  package: r.package || { weight: 0.5, length: 30, breadth: 10, height: 25 },
  declarations: r.declarations || {},
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
    if ((old.courier || '') !== (o.courier || '')) values.courier = o.courier || null;
    if ((old.trackingNumber || '') !== (o.trackingNumber || '')) values.tracking_number = o.trackingNumber || null;
    if ((old.trackingUrl || '') !== (o.trackingUrl || '')) values.tracking_url = o.trackingUrl || null;
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
    if (c.hsn !== undefined && old.hsn !== c.hsn) values.hsn = c.hsn;
    if (c.gstRate !== undefined && old.gstRate !== c.gstRate) values.gst_rate = c.gstRate;
    if (c.package !== undefined && !same(old.package, c.package)) values.package = c.package;
    if (c.declarations !== undefined && !same(old.declarations, c.declarations)) values.declarations = c.declarations;
    if (Object.keys(values).length) ops.push({ table: 'categories', type: 'update', id: c.id, values });
  }

  const sv = {};
  for (const [k, col] of Object.entries(SETTINGS_COLUMNS)) {
    if (next.settings[k] !== undefined && !same(prev.settings[k], next.settings[k])) sv[col] = next.settings[k] === '' && NULLABLE.has(col) ? null : next.settings[k];
  }
  if (Object.keys(sv).length) ops.push({ table: 'settings', type: 'update', id: 1, values: sv });

  const oldCoupons = new Map((prev.coupons || []).map((c) => [c.code, c]));
  const newCoupons = new Map((next.coupons || []).map((c) => [c.code, c]));
  for (const [code, c] of newCoupons) {
    const old = oldCoupons.get(code);
    if (!old) {
      const values = { code };
      COUPON_FIELDS.forEach((f) => c[f] !== undefined && (values[f] = c[f]));
      ops.push({ table: 'coupons', type: 'insert', id: code, key: 'code', values });
    } else {
      const values = {};
      COUPON_FIELDS.forEach((f) => !same(old[f], c[f]) && (values[f] = c[f]));
      if (Object.keys(values).length) ops.push({ table: 'coupons', type: 'update', id: code, key: 'code', values });
    }
  }
  for (const code of oldCoupons.keys()) if (!newCoupons.has(code)) ops.push({ table: 'coupons', type: 'delete', id: code, key: 'code' });
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
    const key = op.key || 'id';
    if (op.type === 'insert') res = await t.insert(op.values).select(key);
    else if (op.type === 'update') res = await t.update(op.values).eq(key, op.id).select(key);
    else res = await t.delete().eq(key, op.id).select(key);
    if (res.error) throw new SyncError(res.error.message, res.error.code, res.error);
    if (!res.data || res.data.length === 0) throw new SyncError('not-allowed', '42501');
  }
  return ops;
}

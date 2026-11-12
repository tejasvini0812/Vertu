// Runs the real migration + seed in an in-process Postgres (PGlite) with minimal Supabase stubs,
// then checks what shoppers, staff (with and without two-step verification) and owners can do.
// Run: npm run test:db
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
const R = new URL('../', import.meta.url).pathname;
const db = new PGlite();
await db.exec(readFileSync(new URL('./supabase-stubs.sql', import.meta.url), 'utf8'));
for (const f of readdirSync(R + 'migrations').sort()) await db.exec(readFileSync(R + 'migrations/' + f, 'utf8'));
await db.exec(readFileSync(R + 'seed.sql', 'utf8'));
await db.exec(readFileSync(R + 'seed.sql', 'utf8')); // idempotent
await db.exec(readFileSync(R + 'sample_orders.sql', 'utf8'));
await db.exec(`insert into public.profiles (id) select id from auth.users on conflict do nothing;`);
await db.exec(`insert into public.admin_users (user_id, role) values
  ('00000000-0000-0000-0000-00000000000a','owner'), ('00000000-0000-0000-0000-00000000000b','staff');`);

const OWNER = '00000000-0000-0000-0000-00000000000a', STAFF = '00000000-0000-0000-0000-00000000000b', SHOP = '00000000-0000-0000-0000-00000000000c';
let pass = 0, fail = 0;
async function as(who, aal, sql, params = []) {
  const role = who ? 'authenticated' : 'anon';
  const EMAILS = { [OWNER]: 'owner@vertu.test', [STAFF]: 'staff@vertu.test', [SHOP]: 'shopper@vertu.test', '00000000-0000-0000-0000-00000000000d': 'other@vertu.test' };
  const claims = JSON.stringify(who ? { sub: who, role, aal, email: EMAILS[who] } : { role });
  return db.transaction(async (tx) => {
    await tx.query(`select set_config('request.jwt.claims', $1, true)`, [claims]);
    await tx.query(`set local role ${role}`);
    return tx.query(sql, params);
  });
}
async function expect(name, fn, check) {
  try {
    const r = await fn();
    const ok = check(r, null);
    ok ? pass++ : fail++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  -> ' + JSON.stringify(r.rows ?? r).slice(0, 200)}`);
  } catch (e) {
    let ok = false;
    try { ok = check(null, e); } catch (_) { ok = false; }
    ok ? pass++ : fail++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  -> error: ' + e.message}`);
  }
}
const rows = (n) => (r) => r && r.rows.length === n;
const affected = (n) => (r) => r && r.affectedRows === n;
const denied = (r, e) => !!e || (r && (r.affectedRows === 0 || r.rows?.length === 0));
const errored = (msg) => (r, e) => !!e && (!msg || e.message.includes(msg));

// shoppers
await db.exec(`update public.products set status='draft' where id='VRT-LP-FOR'`);
await expect('anon sees only active products', () => as(null, null, `select id from products`), rows(14));
await expect('anon reads categories', () => as(null, null, `select * from categories`), rows(3));
await expect('anon reads published content', () => as(null, null, `select published->'hero'->>'headline' h from site_content`), (r) => r?.rows[0]?.h === 'The art of utility.');
await expect('anon cannot read orders', () => as(null, null, `select * from orders`), rows(0));
await expect('anon cannot read settings', () => as(null, null, `select * from settings`), rows(0));
await expect('anon cannot change price', () => as(null, null, `update products set price=1 where id='VRT-SL-CRI'`), denied);
await expect('anon cannot insert product', () => as(null, null, `insert into products (id,category,colour,price) values ('VRT-SL-X','sling','X',1)`), errored());
await expect('signed-in shopper cannot change stock', () => as(SHOP, 'aal2', `update products set stock=999 where id='VRT-SL-CRI'`), denied);
await expect('shopper cannot make themselves admin', () => as(SHOP, 'aal2', `insert into admin_users values ('${SHOP}','owner')`), errored());
await expect('shopper cannot upload images', () => as(SHOP, 'aal2', `insert into storage.objects (bucket_id,name) values ('media','x.jpg')`), errored());
await expect('shopper cannot list team', () => as(SHOP, 'aal2', `select * from team_list()`), errored('not_allowed'));

// staff without two-step verification
await expect('staff without 2-step: own row visible', () => as(STAFF, 'aal1', `select role from admin_users`), (r) => r?.rows.length === 1 && r.rows[0].role === 'staff');
await expect('staff without 2-step: cannot edit', () => as(STAFF, 'aal1', `update products set price=1 where id='VRT-SL-CRI'`), denied);
await expect('staff without 2-step: no orders', () => as(STAFF, 'aal1', `select * from orders`), rows(0));

// staff with two-step
await expect('staff sees drafts too', () => as(STAFF, 'aal2', `select id from products`), rows(15));
await expect('staff edits price + stock', () => as(STAFF, 'aal2', `update products set price=1899, stock=20 where id='VRT-SL-CRI' returning id`), rows(1));
await expect('stock change logged with actor', () => db.query(`select delta, stock_after, actor from inventory_log where sku='VRT-SL-CRI' order by id desc limit 1`), (r) => r.rows[0].delta === 6 && r.rows[0].stock_after === 20 && r.rows[0].actor === STAFF);
await expect('staff adds product', () => as(STAFF, 'aal2', `insert into products (id,category,colour,hex,price,stock,status) values ('VRT-SL-TAN','sling','Tan','#a07850',1999,7,'active') returning id`), rows(1));
await expect('negative stock rejected', () => as(STAFF, 'aal2', `update products set stock=-1 where id='VRT-SL-TAN'`), errored('check'));
await expect('bad colour hex rejected', () => as(STAFF, 'aal2', `update products set hex='red' where id='VRT-SL-TAN'`), errored('check'));
await expect('staff cannot delete product', () => as(STAFF, 'aal2', `delete from products where id='VRT-SL-TAN'`), denied);
await expect('staff reads orders + items', () => as(STAFF, 'aal2', `select o.id from orders o join order_items i on i.order_id=o.id`), (r) => r.rows.length > 28);
await expect('staff changes order status', () => as(STAFF, 'aal2', `update orders set status='Shipped' where id='VRT-10428' returning status`), rows(1));
await expect('invalid order status rejected', () => as(STAFF, 'aal2', `update orders set status='Lost' where id='VRT-10428'`), errored('check'));
await expect('staff cannot edit order total lines', () => as(STAFF, 'aal2', `update order_items set price=1 where order_id='VRT-10428'`), errored('permission'));
await expect('staff cannot change customer email', () => as(STAFF, 'aal2', `update orders set customer_email='x@y.z' where id='VRT-10428'`), errored('permission'));
await expect('staff cannot create orders', () => as(STAFF, 'aal2', `insert into orders (customer_name, customer_email) values ('a','b')`), errored('permission'));
await expect('staff publishes content', () => as(STAFF, 'aal2', `update site_content set published = jsonb_set(published,'{hero,headline}','"Carried with intent."'), published_at=now() returning id`), rows(1));
await expect('staff uploads image', () => as(STAFF, 'aal2', `insert into storage.objects (bucket_id,name) values ('media','products/a.jpg') returning id`), rows(1));
await expect('staff cannot change settings', () => as(STAFF, 'aal2', `update settings set low_stock=9`), denied);
await expect('staff cannot read activity log', () => as(STAFF, 'aal2', `select * from activity()`), errored('not_allowed'));
await expect('staff cannot grant roles', () => as(STAFF, 'aal2', `select team_grant('shopper@vertu.test','owner')`), errored('not_allowed'));

// owner
await expect('owner deletes product', () => as(OWNER, 'aal2', `delete from products where id='VRT-SL-TAN' returning id`), rows(1));
await expect('owner changes low-stock threshold', () => as(OWNER, 'aal2', `update settings set low_stock=4 returning low_stock`), rows(1));
await expect('owner lists team with emails', () => as(OWNER, 'aal2', `select email, role from team_list()`), (r) => r.rows.length === 2 && r.rows.some((x) => x.email === 'staff@vertu.test'));
await expect('owner grants staff by email', () => as(OWNER, 'aal2', `select team_grant('Shopper@Vertu.test ','staff')`), (r) => !!r);
await expect('unknown email gives no_account', () => as(OWNER, 'aal2', `select team_grant('nobody@vertu.test','staff')`), errored('no_account'));
await expect('owner cannot demote self', () => as(OWNER, 'aal2', `select team_grant('owner@vertu.test','staff')`), errored('cannot_demote_self'));
await expect('owner cannot remove self', () => as(OWNER, 'aal2', `select team_revoke('${OWNER}')`), errored('cannot_remove_self'));
await expect('owner removes staff', () => as(OWNER, 'aal2', `select team_revoke('${SHOP}')`), (r) => !!r);
await expect('activity shows who did what', () => as(OWNER, 'aal2', `select email, action, entity, entity_id, changes from activity(100)`), (r) => {
  const e = r.rows;
  return e.some((x) => x.email === 'staff@vertu.test' && x.entity === 'products' && x.entity_id === 'VRT-SL-CRI' && x.changes.price.to === 1899)
    && e.some((x) => x.entity === 'orders' && x.changes.status.to === 'Shipped')
    && e.some((x) => x.entity === 'site_content' && x.changes.published === '(changed)')
    && e.some((x) => x.action === 'delete' && x.entity_id === 'VRT-SL-TAN');
});
await expect('anon cannot call team functions', () => as(null, null, `select * from team_list()`), errored());
await expect('order numbers continue from 10500', () => db.query(`insert into orders (customer_name, customer_email) values ('a','a@b.c') returning id`), (r) => r.rows[0].id === 'VRT-10500');

// ---------------------------------------------------------------- Phase 2: customers
const OTHER = '00000000-0000-0000-0000-00000000000d';
await db.exec(`insert into auth.users (id, email, raw_user_meta_data) values ('${OTHER}', 'other@vertu.test', '{"full_name":"Other Person"}')`);
await expect('new account gets a profile with their name', () => db.query(`select full_name from profiles where id='${OTHER}'`), (r) => r.rows[0]?.full_name === 'Other Person');
await expect('collection details readable by anyone', () => as(null, null, `select details->'features' f from categories where id='sling'`), (r) => r.rows[0]?.f?.length === 3);
await expect('shopper cannot edit collection details', () => as(SHOP, 'aal2', `update categories set description='x' where id='sling'`), denied);
await expect('staff edits collection copy', () => as(STAFF, 'aal2', `update categories set description=description where id='mens' returning id`), rows(1));
await expect('staff cannot add collections', () => as(STAFF, 'aal2', `insert into categories (id,name,code,unit) values ('tote','Totes','TT','Tote')`), errored('row-level security'));
await expect('owner edits collection details', () => as(OWNER, 'aal2', `update categories set details = jsonb_set(details,'{specs,Material}','"Cotton canvas"') where id='sling' returning id`), rows(1));
await expect('shopper updates own profile', () => as(SHOP, 'aal1', `update profiles set full_name='Shop Per', phone='+919876543210' returning id`), rows(1));
await expect('bad phone rejected', () => as(SHOP, 'aal1', `update profiles set phone='12345'`), errored('check'));
await expect('shopper cannot read other profiles', () => as(SHOP, 'aal1', `select id from profiles`), rows(1));
await expect('shopper cannot change profile id', () => as(SHOP, 'aal1', `update profiles set id='${OTHER}'`), errored('permission'));
const addr = (who, extra = '') => `insert into addresses (user_id, full_name, phone, line1, city, state, pin${extra ? ', is_default' : ''}) values ('${who}', 'A', '+919876543210', '1 Road', 'Pune', 'Maharashtra', '411001'${extra ? ', ' + extra : ''}) returning id, is_default`;
await expect('first address becomes default', () => as(SHOP, 'aal1', addr(SHOP)), (r) => r.rows[0].is_default === true);
await expect('new default unsets old default', async () => { await as(SHOP, 'aal1', addr(SHOP, 'true')); return as(SHOP, 'aal1', `select count(*)::int n from addresses where is_default`); }, (r) => r.rows[0].n === 1);
await expect('cannot add address to someone else', () => as(SHOP, 'aal1', addr(OTHER)), errored('row-level security'));
await expect('bad PIN rejected', () => as(SHOP, 'aal1', `insert into addresses (full_name, phone, line1, city, state, pin) values ('A','+919876543210','x','y','z','012345')`), errored('check'));
await expect('others cannot see my addresses', () => as(OTHER, 'aal1', `select * from addresses`), rows(0));
await expect('staff can read addresses for orders', () => as(STAFF, 'aal2', `select * from addresses`), rows(2));
await expect('address limit of 10', async () => { for (let i = 0; i < 8; i++) await as(SHOP, 'aal1', addr(SHOP)); return as(SHOP, 'aal1', addr(SHOP)); }, errored('address_limit'));
await expect('wishlist add own', () => as(SHOP, 'aal1', `insert into wishlist_items (sku) values ('VRT-SL-CRI') returning sku`), rows(1));
await expect('wishlist private', () => as(OTHER, 'aal1', `select * from wishlist_items`), rows(0));
await expect('anon cannot use wishlist', () => as(null, null, `insert into wishlist_items (user_id, sku) values ('${SHOP}','VRT-SL-COB')`), errored());
await expect('cart saved for own account', () => as(SHOP, 'aal1', `insert into carts (items) values ('[{"sku":"VRT-SL-CRI","qty":2}]') returning user_id`), rows(1));
await expect('cart private', () => as(OTHER, 'aal1', `select * from carts`), rows(0));
await expect('oversized cart rejected', () => as(OTHER, 'aal1', `insert into carts (items) select jsonb_agg(jsonb_build_object('sku','x','qty',1)) from generate_series(1,51)`), errored('check'));
await expect('anon asks for back-in-stock alert', () => as(null, null, `insert into stock_alerts (sku, email) values ('VRT-SL-MUS', 'fan@example.com')`), affected(1));
await expect('duplicate alert is a unique violation', () => as(null, null, `insert into stock_alerts (sku, email) values ('VRT-SL-MUS', 'fan@example.com')`), errored('duplicate'));
await expect('no alerts for draft products', () => as(null, null, `insert into stock_alerts (sku, email) values ('VRT-LP-FOR', 'fan@example.com')`), errored('row-level security'));
await expect('alert cannot be pre-marked as sent', () => as(null, null, `insert into stock_alerts (sku, email, notified_at) values ('VRT-SL-COB', 'x@example.com', now())`), errored('row-level security'));
await expect('anon cannot read alert emails', () => as(null, null, `select * from stock_alerts`), rows(0));
await expect('staff sees waiting alerts', () => as(STAFF, 'aal2', `select * from stock_alerts`), rows(1));
await expect('customer reads own orders only', async () => {
  await db.exec(`update orders set customer_id='${SHOP}' where id in ('VRT-10427','VRT-10426')`);
  return as(SHOP, 'aal1', `select o.id, count(i.*)::int n from orders o join order_items i on i.order_id=o.id group by o.id`);
}, (r) => r.rows.length === 2 && r.rows.every((x) => x.n > 0));
await expect('customer cannot change own order status', () => as(SHOP, 'aal1', `update orders set status='Delivered' where id='VRT-10427'`), denied);
await expect('customer requests deletion', () => as(SHOP, 'aal1', `insert into data_requests (email, kind) values ('shopper@vertu.test','delete') returning id`), rows(1));
await expect('customer cannot mark own request resolved', () => as(SHOP, 'aal1', `update data_requests set resolved_at=now()`), denied);
await expect('owner sees deletion requests', () => as(OWNER, 'aal2', `select * from data_requests`), rows(1));
await expect('deleting an account removes its data', async () => {
  await db.exec(`delete from auth.users where id='${SHOP}'`);
  return db.query(`select (select count(*) from addresses where user_id='${SHOP}')::int + (select count(*) from carts where user_id='${SHOP}')::int + (select count(*) from wishlist_items where user_id='${SHOP}')::int + (select count(*) from profiles where id='${SHOP}')::int n`);
}, (r) => r.rows[0].n === 0);

// ---------------------------------------------------------------- Phase 3: checkout and payments
const svc = (sql, params = []) => db.transaction(async (tx) => {
  await tx.query(`select set_config('request.jwt.claims', '{"role":"service_role"}', true)`);
  await tx.query('set local role service_role');
  return tx.query(sql, params);
});
const J = (x) => JSON.stringify(x);
const quote = (items, coupon = null, method = 'razorpay') => as(null, null, `select quote_checkout($1::jsonb, $2, $3) q`, [J(items), coupon, method]).then((r) => r.rows[0].q);
const stock = async (sku) => (await db.query(`select stock from products where id=$1`, [sku])).rows[0].stock;
const contact = { email: 'Guest@Example.com', phone: '+919876543210' };
const address = { full_name: 'Guest Buyer', line1: '5 Lake Street', line2: 'Near park', city: 'Pune', state: 'Maharashtra', pin: '411004' };
const create = (items, coupon = null, method = 'razorpay', c = contact, a = address, user = null) =>
  svc(`select create_order($1::jsonb, $2, $3, $4::jsonb, $5::jsonb, $6) r`, [J(items), coupon, method, J(c), J(a), user]).then((r) => r.rows[0].r);

await expect('shoppers can read shipping rules', () => as(null, null, `select store_rules() r`), (r) => r.rows[0].r.cod_enabled === false);
await expect('quote uses database prices', async () => ({ rows: [await quote([{ sku: 'VRT-LP-CRI', qty: 2, price: 1 }])] }), (r) => r.rows[0].subtotal === 4998 && r.rows[0].total === 4998 && r.rows[0].problems.length === 0);
await expect('quote flags short stock, drafts, bad qty, duplicates', async () => ({ rows: [await quote([{ sku: 'VRT-SL-MUS', qty: 1 }, { sku: 'VRT-LP-FOR', qty: 1 }, { sku: 'VRT-LP-COB', qty: 0 }, { sku: 'VRT-MS-NAV', qty: 1 }, { sku: 'VRT-MS-NAV', qty: 1 }])] }),
  (r) => ['insufficient', 'unavailable', 'bad_qty', 'duplicate'].every((k) => r.rows[0].problems.some((p) => p.kind === k)));
await expect('empty bag is a problem', async () => ({ rows: [await quote([])] }), (r) => r.rows[0].problems[0].kind === 'empty');
await db.exec(`update settings set shipping_fee = 99, free_shipping_over = 3000`);
await expect('shipping charged under the threshold', async () => ({ rows: [await quote([{ sku: 'VRT-SL-COB', qty: 1 }])] }), (r) => r.rows[0].shipping === 99 && r.rows[0].total === 1898);
await expect('free shipping over the threshold', async () => ({ rows: [await quote([{ sku: 'VRT-SL-COB', qty: 2 }])] }), (r) => r.rows[0].shipping === 0);
await expect('staff create a coupon', () => as(STAFF, 'aal2', `insert into coupons (code, kind, value, min_subtotal) values ('WELCOME10','percent',10,2000) returning code`), rows(1));
await expect('coupon codes are validated', () => as(STAFF, 'aal2', `insert into coupons (code, kind, value) values ('bad code','percent',10)`), errored('check'));
await expect('percent coupons capped at 90', () => as(STAFF, 'aal2', `insert into coupons (code, kind, value) values ('HALFOFF','percent',95)`), errored('check'));
await expect('shoppers cannot list coupons', () => as(OTHER, 'aal1', `select * from coupons`), rows(0));
await expect('coupon below minimum is refused', async () => ({ rows: [await quote([{ sku: 'VRT-SL-COB', qty: 1 }], 'welcome10')] }), (r) => r.rows[0].coupon.valid === false && r.rows[0].coupon.reason === 'min_subtotal' && r.rows[0].discount === 0);
await expect('coupon applies (case-insensitive) and can remove free shipping', async () => ({ rows: [await quote([{ sku: 'VRT-SL-COB', qty: 2 }], ' welcome10 ')] }),
  (r) => r.rows[0].coupon.valid && r.rows[0].discount === 359 && r.rows[0].shipping === 0 && r.rows[0].total === 3598 - 359);
await db.exec(`insert into coupons (code, kind, value, ends_at, starts_at) values ('OLD','amount',100, now() - interval '1 day', now() - interval '2 days'), ('ONCE','amount',200, null, null)`);
await db.exec(`update coupons set max_uses = 1 where code = 'ONCE'`);
await expect('expired coupon refused', async () => ({ rows: [await quote([{ sku: 'VRT-SL-COB', qty: 1 }], 'OLD')] }), (r) => r.rows[0].coupon.reason === 'expired');
await expect('cash on delivery off by default', async () => ({ rows: [await quote([{ sku: 'VRT-SL-COB', qty: 1 }], null, 'cod')] }), (r) => r.rows[0].problems.some((p) => p.kind === 'cod_off'));
await db.exec(`update settings set cod_enabled = true, cod_fee = 49, cod_max = 4000`);
await expect('cash on delivery adds its fee', async () => ({ rows: [await quote([{ sku: 'VRT-SL-COB', qty: 1 }], null, 'cod')] }), (r) => r.rows[0].cod_fee === 49 && r.rows[0].total === 1799 + 99 + 49 && !r.rows[0].problems.length);
await expect('cash on delivery has a limit', async () => ({ rows: [await quote([{ sku: 'VRT-LP-CRI', qty: 2 }], null, 'cod')] }), (r) => r.rows[0].problems.some((p) => p.kind === 'cod_limit'));

await expect('browsers cannot create orders', () => as(OTHER, 'aal1', `select create_order('[{"sku":"VRT-LP-CRI","qty":1}]', null, 'razorpay', '{}', '{}', null)`), errored('permission'));
await expect('browsers cannot mark orders paid', () => as(null, null, `select mark_order_paid('x','y',1)`), errored('permission'));
await expect('browsers cannot call the raw pricer', () => as(null, null, `select price_cart('[]')`), errored('permission'));
await expect('bad phone refused', async () => ({ rows: [await create([{ sku: 'VRT-LP-CRI', qty: 1 }], null, 'razorpay', { email: 'a@b.co', phone: '98765' })] }), (r) => r.rows[0].error === 'bad_phone');
await expect('bad PIN refused', async () => ({ rows: [await create([{ sku: 'VRT-LP-CRI', qty: 1 }], null, 'razorpay', contact, { ...address, pin: '000000' })] }), (r) => r.rows[0].error === 'bad_address');

const before = await stock('VRT-LP-CRI');
let ord;
await expect('server creates an order and holds the stock', async () => { ord = await create([{ sku: 'VRT-LP-CRI', qty: 2 }, { sku: 'VRT-SL-COB', qty: 1 }], 'WELCOME10'); return { rows: [ord] }; },
  (r) => r.rows[0].ok && r.rows[0].total === 4998 + 1799 - 679 && r.rows[0].expires_at);
await expect('stock went down and was logged as an order', async () => ({ rows: [{ s: await stock('VRT-LP-CRI'), log: (await db.query(`select reason, delta from inventory_log where sku='VRT-LP-CRI' order by id desc limit 1`)).rows[0] }] }),
  (r) => r.rows[0].s === before - 2 && r.rows[0].log.reason === 'order' && r.rows[0].log.delta === -2);
await expect('order stored awaiting payment, email lower-cased', () => db.query(`select payment_status, status, customer_email, ship_address, coupon_code, discount from orders where id=$1`, [ord.order_id]),
  (r) => r.rows[0].payment_status === 'awaiting' && r.rows[0].status === 'Pending' && r.rows[0].customer_email === 'guest@example.com' && r.rows[0].ship_address === '5 Lake Street, Near park' && r.rows[0].coupon_code === 'WELCOME10' && r.rows[0].discount === 679);
await expect('coupon use counted', () => db.query(`select used_count from coupons where code='WELCOME10'`), (r) => r.rows[0].used_count === 1);
await expect('staff cannot move an unpaid order along', () => as(STAFF, 'aal2', `update orders set status='Shipped' where id='${ord.order_id}'`), errored('order_unpaid'));
await expect('more than in stock is refused and nothing changes', async () => { const b = await stock('VRT-MS-MUS'); const r = await create([{ sku: 'VRT-MS-MUS', qty: 9 }]); return { rows: [{ r, same: (await stock('VRT-MS-MUS')) === b }] }; },
  (r) => r.rows[0].r.error === 'cart' && r.rows[0].same);
await expect('order lookup needs the secret token', () => as(null, null, `select order_lookup($1, $2) a, order_lookup($1, gen_random_uuid()) b`, [ord.order_id, ord.access_token]),
  (r) => r.rows[0].a.total === ord.total && r.rows[0].a.lines.length === 2 && r.rows[0].b === null);

await svc(`select attach_razorpay_order($1, 'order_RZP1')`, [ord.order_id]);
await expect('wrong amount is not accepted as payment', () => svc(`select mark_order_paid('order_RZP1', 'pay_X', 100) r`), (r) => r.rows[0].r.error === 'amount_mismatch');
await expect('mismatch is flagged for a person', () => db.query(`select flag, payment_status from orders where id=$1`, [ord.order_id]), (r) => /amount_mismatch/.test(r.rows[0].flag) && r.rows[0].payment_status === 'awaiting');
await expect('correct payment marks it paid', () => svc(`select mark_order_paid('order_RZP1', 'pay_OK', $1) r`, [ord.total * 100]), (r) => r.rows[0].r.ok && !r.rows[0].r.already);
await expect('second confirmation is harmless', () => svc(`select mark_order_paid('order_RZP1', 'pay_OK', $1) r`, [ord.total * 100]), (r) => r.rows[0].r.already === true);
await expect('staff can now ship it', () => as(STAFF, 'aal2', `update orders set status='Shipped' where id='${ord.order_id}' returning id`), rows(1));
await expect('staff cannot cancel from the status buttons', () => as(STAFF, 'aal2', `update orders set status='Cancelled' where id='${ord.order_id}'`), errored('use_cancel'));
await expect('partial refund recorded', () => svc(`select settle_cancel_refund($1, 50000, 'rfnd_1', false, false, null, 'damaged strap') r`, [ord.order_id]), (r) => r.rows[0].r.refunded_amount === 500);
await expect('refund larger than paid is refused', () => svc(`select settle_cancel_refund($1, $2, 'rfnd_2', false, false, null, '') r`, [ord.order_id, ord.total * 100]), (r) => r.rows[0].r.error === 'refund_too_large');
const cobBefore = await stock('VRT-SL-COB');
await expect('cancel with full refund restocks', () => svc(`select settle_cancel_refund($1, $2, 'rfnd_3', true, true, null, 'customer cancelled') r`, [ord.order_id, (ord.total - 500) * 100]), (r) => r.rows[0].r.ok);
await expect('order now refunded and cancelled, stock back', async () => ({ rows: [{ o: (await db.query(`select status, payment_status, refunded_amount, total from orders where id=$1`, [ord.order_id])).rows[0], s: await stock('VRT-SL-COB') }] }),
  (r) => r.rows[0].o.status === 'Cancelled' && r.rows[0].o.payment_status === 'refunded' && r.rows[0].o.refunded_amount === r.rows[0].o.total && r.rows[0].s === cobBefore + 1);

// holds expire
let o2;
await expect('second order holds stock', async () => { o2 = await create([{ sku: 'VRT-LP-BLA', qty: 1 }], 'ONCE'); return { rows: [o2] }; }, (r) => r.rows[0].ok);
await expect('a one-use coupon is now used up', async () => ({ rows: [await quote([{ sku: 'VRT-LP-BLA', qty: 1 }], 'ONCE')] }), (r) => r.rows[0].coupon.reason === 'used_up');
const blaHeld = await stock('VRT-LP-BLA');
await svc(`select attach_razorpay_order($1, 'order_RZP2')`, [o2.order_id]);
await db.exec(`update orders set expires_at = now() - interval '1 minute' where id='${o2.order_id}'`);
await expect('expired holds are released', () => svc(`select release_expired_orders() n`), (r) => r.rows[0].n === 1);
await expect('released: stock back, coupon freed, order expired', async () => ({ rows: [{ s: await stock('VRT-LP-BLA'), o: (await db.query(`select status, payment_status from orders where id=$1`, [o2.order_id])).rows[0], q: await quote([{ sku: 'VRT-LP-BLA', qty: 1 }], 'ONCE') }] }),
  (r) => r.rows[0].s === blaHeld + 1 && r.rows[0].o.payment_status === 'expired' && r.rows[0].o.status === 'Cancelled' && r.rows[0].q.coupon.valid);
await expect('payment after expiry still lands (stock available)', () => svc(`select mark_order_paid('order_RZP2','pay_late',$1) r`, [o2.total * 100]), (r) => r.rows[0].r.ok && !r.rows[0].r.flag);
await expect('late order is live again and stock retaken', async () => ({ rows: [{ s: await stock('VRT-LP-BLA'), o: (await db.query(`select status, payment_status, flag from orders where id=$1`, [o2.order_id])).rows[0] }] }),
  (r) => r.rows[0].s === blaHeld && r.rows[0].o.status === 'Pending' && r.rows[0].o.payment_status === 'paid' && r.rows[0].o.flag === null);
let o3;
o3 = await create([{ sku: 'VRT-LP-MUS', qty: 4 }]);
await svc(`select attach_razorpay_order($1, 'order_RZP3')`, [o3.order_id]);
await db.exec(`update orders set expires_at = now() - interval '1 minute' where id='${o3.order_id}'`);
await svc(`select release_expired_orders()`);
await db.exec(`update products set stock = 1 where id='VRT-LP-MUS'`);
await expect('late payment without stock is flagged for a refund', () => svc(`select mark_order_paid('order_RZP3','pay_late2',$1) r`, [o3.total * 100]), (r) => r.rows[0].r.flag === 'VRT-LP-MUS');
await expect('stock was not taken below zero', async () => ({ rows: [{ s: await stock('VRT-LP-MUS') }] }), (r) => r.rows[0].s === 1);

// cash on delivery
let cod;
await expect('cash on delivery order', async () => { cod = await create([{ sku: 'VRT-SL-BLA', qty: 1 }], null, 'cod', { email: 'other@vertu.test', phone: '+919123456789' }); return { rows: [cod] }; }, (r) => r.rows[0].ok && r.rows[0].total === 1799 + 99 + 49 && !r.rows[0].expires_at);
await expect('delivered cash order counts as paid', async () => {
  for (const s of ['Processing', 'Shipped', 'Delivered']) await as(STAFF, 'aal2', `update orders set status='${s}' where id='${cod.order_id}'`);
  return db.query(`select payment_status, paid_at from orders where id=$1`, [cod.order_id]);
}, (r) => r.rows[0].payment_status === 'paid' && r.rows[0].paid_at);
await expect('guest orders join the account with the same email', async () => {
  const claimed = await as(OTHER, 'aal1', `select claim_my_orders() n`);
  const mine = await as(OTHER, 'aal1', `select id from orders`);
  return { rows: [{ n: claimed.rows[0].n, ids: mine.rows.map((x) => x.id) }] };
}, (r) => r.rows[0].n === 1 && r.rows[0].ids.length === 1 && r.rows[0].ids[0] === cod.order_id);
await expect('anon cannot claim orders', () => as(null, null, `select claim_my_orders()`), errored('permission'));

// ---------------------------------------------------------------- Phase 4: emails
const outbox = async (where = 'true') => (await db.query(`select kind, to_email, payload, dedupe_key, status from email_outbox where ${where} order by id`)).rows;
const kinds = async (orderId) => (await outbox(`related_order = '${orderId}'`)).map((r) => r.kind);
await db.exec(`update settings set notify_email = 'store@vertu.test'`);
await db.exec(`delete from email_outbox`);

let e1;
await expect('cash order emails the buyer and the store', async () => {
  e1 = await create([{ sku: 'VRT-MS-BLA', qty: 1 }], null, 'cod', { email: 'Asha@Example.com', phone: '+919811111111' });
  return { rows: [await kinds(e1.order_id)] };
}, (r) => r.rows[0].join() === 'order_confirmed,admin_new_order');
await expect('order email has lines, totals and the private link token', () => db.query(`select payload, to_email from email_outbox where kind='order_confirmed' and related_order=$1`, [e1.order_id]),
  (r) => r.rows[0].to_email === 'asha@example.com' && r.rows[0].payload.lines[0].name === 'Men’s Sling Bag' && r.rows[0].payload.total === e1.total && r.rows[0].payload.token === e1.access_token);
let e2;
await expect('online order: nothing until paid', async () => { e2 = await create([{ sku: 'VRT-MS-NAV', qty: 1 }]); return { rows: [await kinds(e2.order_id)] }; }, (r) => r.rows[0].length === 0);
await svc(`select attach_razorpay_order($1, 'order_E2')`, [e2.order_id]);
await svc(`select mark_order_paid('order_E2','pay_E2',$1)`, [e2.total * 100]);
await svc(`select mark_order_paid('order_E2','pay_E2',$1)`, [e2.total * 100]);
await expect('paid: confirmation sent once', async () => ({ rows: [await kinds(e2.order_id)] }), (r) => r.rows[0].join() === 'order_confirmed,admin_new_order');
await expect('staff add tracking', () => as(STAFF, 'aal2', `update orders set courier='Delhivery', tracking_number='DL123', tracking_url='https://track.example/DL123' where id='${e2.order_id}' returning id`), rows(1));
await expect('tracking link must be a web address', () => as(STAFF, 'aal2', `update orders set tracking_url='javascript:alert(1)' where id='${e2.order_id}'`), errored('check'));
await expect('shoppers cannot add tracking', () => as(OTHER, 'aal1', `update orders set courier='x' where id='${e2.order_id}'`), denied);
await as(STAFF, 'aal2', `update orders set status='Processing' where id='${e2.order_id}'`);
await as(STAFF, 'aal2', `update orders set status='Shipped' where id='${e2.order_id}'`);
await expect('shipped email carries tracking', () => db.query(`select payload from email_outbox where kind='order_shipped' and related_order=$1`, [e2.order_id]), (r) => r.rows[0]?.payload.tracking_number === 'DL123');
await as(STAFF, 'aal2', `update orders set status='Delivered' where id='${e2.order_id}'`);
await svc(`select settle_cancel_refund($1, 20000, 'rf', false, false, null, 'goodwill')`, [e2.order_id]);
await expect('delivered and refund emails', async () => ({ rows: [await kinds(e2.order_id)] }), (r) => r.rows[0].join() === 'order_confirmed,admin_new_order,order_shipped,order_delivered,order_refunded');
await expect('refund email states the amount', () => db.query(`select payload from email_outbox where kind='order_refunded' and related_order=$1`, [e2.order_id]), (r) => r.rows[0].payload.refund === 200);
await svc(`select settle_cancel_refund($1, 0, null, true, true, null, 'customer asked')`, [e1.order_id]);
await expect('cancelling a confirmed order emails once', async () => ({ rows: [await kinds(e1.order_id)] }), (r) => r.rows[0].join() === 'order_confirmed,admin_new_order,order_cancelled');
let e3;
e3 = await create([{ sku: 'VRT-MS-NAV', qty: 1 }]);
await db.exec(`update orders set expires_at = now() - interval '1 minute' where id='${e3.order_id}'`);
await svc(`select release_expired_orders()`);
await expect('abandoned online checkouts expire quietly', async () => ({ rows: [await kinds(e3.order_id)] }), (r) => r.rows[0].length === 0);

await expect('back in stock emails everyone who asked', async () => {
  await as(STAFF, 'aal2', `update products set stock = 5 where id='VRT-SL-MUS'`);
  return { rows: [await outbox(`kind='back_in_stock'`)] };
}, (r) => r.rows[0].length === 1 && r.rows[0][0].to_email === 'fan@example.com' && r.rows[0][0].payload.colour === 'Mustard');
await expect('...and only once', async () => {
  await as(STAFF, 'aal2', `update products set stock = 0 where id='VRT-SL-MUS'`);
  await as(STAFF, 'aal2', `update products set stock = 3 where id='VRT-SL-MUS'`);
  return { rows: [await outbox(`kind='back_in_stock'`), (await db.query(`select notified_at from stock_alerts where sku='VRT-SL-MUS'`)).rows[0]] };
}, (r) => r.rows[0].length === 1 && r.rows[1].notified_at);
await expect('crossing the low-stock line alerts the store once a day', async () => {
  await db.exec(`update products set stock = 20 where id='VRT-LP-COB'`);
  await as(STAFF, 'aal2', `update products set stock = 3 where id='VRT-LP-COB'`);
  await as(STAFF, 'aal2', `update products set stock = 9 where id='VRT-LP-COB'`);
  await as(STAFF, 'aal2', `update products set stock = 2 where id='VRT-LP-COB'`);
  return { rows: [await outbox(`kind='admin_low_stock' and payload->>'sku'='VRT-LP-COB'`)] };
}, (r) => r.rows[0].length === 1 && r.rows[0][0].to_email === 'store@vertu.test' && r.rows[0][0].payload.stock === 3);
await expect('no store address, no store emails', async () => {
  await db.exec(`update settings set notify_email = null`);
  const x = await create([{ sku: 'VRT-SL-BLA', qty: 1 }], null, 'cod', { email: 'b@example.com', phone: '+919822222222' });
  await db.exec(`update settings set notify_email = 'store@vertu.test'`);
  return { rows: [await kinds(x.order_id)] };
}, (r) => r.rows[0].join() === 'order_confirmed');

await expect('newsletter sign-up sends a confirmation', () => as(null, null, `select subscribe_newsletter(' News@Example.com ', 'footer') r`), (r) => r.rows[0].r.ok);
await expect('signing up twice in a day sends one email', async () => { await as(null, null, `select subscribe_newsletter('news@example.com')`); return { rows: await outbox(`kind='newsletter_confirm'`) }; }, (r) => r.rows.length === 1 && r.rows[0].to_email === 'news@example.com');
await expect('bad email refused', () => as(null, null, `select subscribe_newsletter('nope') r`), (r) => r.rows[0].r.error === 'bad_email');
await expect('subscriber list is private', () => as(null, null, `select * from newsletter_subscribers`), rows(0));
await expect('staff cannot read subscribers', () => as(STAFF, 'aal2', `select * from newsletter_subscribers`), rows(0));
const tok = (await db.query(`select token from newsletter_subscribers where email='news@example.com'`)).rows[0].token;
await expect('wrong token confirms nothing', () => as(null, null, `select confirm_newsletter(gen_random_uuid()) r`), (r) => r.rows[0].r.ok === false);
await expect('confirm link subscribes', async () => { await as(null, null, `select confirm_newsletter($1)`, [tok]); return db.query(`select status from newsletter_subscribers where email='news@example.com'`); }, (r) => r.rows[0].status === 'subscribed');
await expect('owner can see subscribers', () => as(OWNER, 'aal2', `select email from newsletter_subscribers where status='subscribed'`), rows(1));
await expect('one-click unsubscribe', async () => { await as(null, null, `select unsubscribe_newsletter($1)`, [tok]); return db.query(`select status from newsletter_subscribers where email='news@example.com'`); }, (r) => r.rows[0].status === 'unsubscribed');
await expect('account opt-in joins the list without a confirmation email', async () => {
  await as(OTHER, 'aal1', `update profiles set marketing_opt_in = true where id='${OTHER}'`);
  return db.query(`select status from newsletter_subscribers where email='other@vertu.test'`);
}, (r) => r.rows[0]?.status === 'subscribed');

await expect('abandoned-bag emails are off by default', () => svc(`select queue_abandoned_carts() n`), (r) => r.rows[0].n === 0);
await db.exec(`update orders set customer_id = null where customer_id = '${OTHER}';
  update settings set abandoned_cart_enabled = true;
  insert into carts (user_id, items, updated_at) values ('${OTHER}', '[{"sku":"VRT-LP-CRI","qty":1},{"sku":"VRT-SL-MUS","qty":9}]', now()) on conflict (user_id) do update set items = excluded.items;`);
await db.exec(`alter table carts disable trigger carts_touch; update carts set updated_at = now() - interval '4 hours' where user_id='${OTHER}'; alter table carts enable trigger carts_touch;`);
await expect('a 4-hour-old bag gets one reminder (opted-in only)', () => svc(`select queue_abandoned_carts() n`), (r) => r.rows[0].n === 1);
await expect('reminder lists the bag with an unsubscribe link', () => db.query(`select payload from email_outbox where kind='abandoned_cart'`), (r) => r.rows[0].payload.items.length === 2 && r.rows[0].payload.unsubscribe);
await expect('not repeated', async () => { await svc(`select queue_abandoned_carts()`); return { rows: await outbox(`kind='abandoned_cart'`) }; }, (r) => r.rows.length === 1);
await expect('no reminder if they ordered after saving the bag', async () => {
  await db.exec(`alter table carts disable trigger carts_touch; update carts set updated_at = now() - interval '27 hours' where user_id='${OTHER}'; alter table carts enable trigger carts_touch; update orders set customer_id='${OTHER}', created_at = now() - interval '1 hour' where id='${e2.order_id}'`);
  return svc(`select queue_abandoned_carts() n`);
}, (r) => r.rows[0].n === 0);

await expect('browsers cannot read or claim the outbox', async () => {
  const a = await as(OTHER, 'aal1', `select * from email_outbox`);
  let b = null; try { await as(null, null, `select claim_outbox(10)`); } catch (e) { b = e.message; }
  return { rows: [{ a: a.rows.length, b }] };
}, (r) => r.rows[0].a === 0 && /permission/.test(r.rows[0].b));
await expect('staff see the email log', () => as(STAFF, 'aal2', `select count(*)::int n from email_outbox`), (r) => r.rows[0].n > 10);
let claimed;
await expect('sender claims due emails', async () => { claimed = (await svc(`select claim_outbox(5) r`)).rows[0].r; return { rows: claimed }; }, (r) => r.rows.length === 5 && r.rows.every((x) => x.attempts === 1));
await expect('a second sender gets different emails', async () => ({ rows: (await svc(`select claim_outbox(5) r`)).rows[0].r }), (r) => r.rows.every((x) => !claimed.some((c) => c.id === x.id)));
await svc(`select complete_outbox($1, true, 're_1', null)`, [claimed[0].id]);
await svc(`select complete_outbox($1, false, null, 'smtp timeout')`, [claimed[1].id]);
await expect('sent and retried', () => db.query(`select id, status, send_after > now() later, last_error from email_outbox where id in ($1,$2) order by id`, [claimed[0].id, claimed[1].id]),
  (r) => r.rows[0].status === 'sent' && r.rows[1].status === 'pending' && r.rows[1].later && r.rows[1].last_error === 'smtp timeout');
await expect('gives up after five tries', async () => {
  await db.exec(`update email_outbox set attempts = 4, send_after = now() - interval '1 minute' where id = ${claimed[1].id}`);
  const c = (await svc(`select claim_outbox(100) r`)).rows[0].r;
  await svc(`select complete_outbox($1, false, null, 'still failing')`, [claimed[1].id]);
  return db.query(`select status, attempts from email_outbox where id=$1`, [claimed[1].id]);
}, (r) => r.rows[0].status === 'failed' && r.rows[0].attempts === 5);
await expect('staff cannot retry emails', () => as(STAFF, 'aal2', `select retry_email(${claimed[1].id})`), errored('not_allowed'));
await expect('owner retries a failed email', async () => { await as(OWNER, 'aal2', `select retry_email(${claimed[1].id})`); return db.query(`select status, attempts from email_outbox where id=$1`, [claimed[1].id]); }, (r) => r.rows[0].status === 'pending' && r.rows[0].attempts === 0);
await expect('stale emails are skipped, not sent days late', async () => {
  await db.exec(`update email_outbox set created_at = now() - interval '4 days' where id = ${claimed[1].id}`);
  await svc(`select claim_outbox(1)`);
  return db.query(`select status from email_outbox where id=$1`, [claimed[1].id]);
}, (r) => r.rows[0].status === 'skipped');

// ---------------------------------------------------------------- Phase 5: shipping, invoices, returns
const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];
await expect('financial year runs April to March', () => db.query(`select fy_of('2026-11-12') a, fy_of('2027-02-01') b, fy_of('2027-04-01 09:00+05:30') c`), (r) => r.rows[0].a === '26-27' && r.rows[0].b === '26-27' && r.rows[0].c === '27-28');
await db.exec(`update settings set legal_name = '', gst_registered = true, gstin = '27ABCDE1234F1Z5', business_state = 'Maharashtra', business_address = '12 Studio Lane, Mumbai 400050', invoice_prefix = 'VRT', shipping_fee = 99, free_shipping_over = 3000, cod_enabled = true, cod_fee = 49, cod_max = 5000`);
await expect('GSTIN format checked', () => as(OWNER, 'aal2', `update settings set gstin = 'NOTAGSTIN'`), errored('check'));
const pune = { full_name: 'Kabir Singh', line1: '4 Lake Street', city: 'Pune', state: 'Maharashtra', pin: '411004' };
const delhi = { full_name: 'Meera Kapoor', line1: '14 Park Avenue', city: 'New Delhi', state: 'Delhi', pin: '110016' };
const cont = { email: 'kabir@example.com', phone: '+919811122233' };
await db.exec(`update products set stock = 20 where id in ('VRT-LP-BLA','VRT-SL-COB','VRT-MS-TEA')`);
const paidOrder = async (items, coupon, addr) => {
  const o = await create(items, coupon, 'razorpay', cont, addr);
  await svc(`select attach_razorpay_order($1, $2)`, [o.order_id, 'rzp_' + o.order_id]);
  await svc(`select mark_order_paid($1, 'pay_x', $2)`, ['rzp_' + o.order_id, o.total * 100]);
  return o;
};
const i1 = await paidOrder([{ sku: 'VRT-LP-BLA', qty: 1 }], null, pune);
await expect('no invoice without seller details', () => as(STAFF, 'aal2', `select create_invoice($1) r`, [i1.order_id]), (r) => r.rows[0].r.error === 'seller_details_missing');
await db.exec(`update settings set legal_name = 'Vertu Lifestyle LLP'`);
await expect('unpaid orders are not invoiced', async () => { const x = await create([{ sku: 'VRT-SL-COB', qty: 1 }], null, 'razorpay', cont, pune); return as(STAFF, 'aal2', `select create_invoice($1) r`, [x.order_id]); }, (r) => r.rows[0].r.error === 'not_invoiceable');
await expect('shoppers cannot issue invoices', () => as(OTHER, 'aal1', `select create_invoice($1)`, [i1.order_id]), errored('not_allowed'));

// shipment booked, then courier updates
await expect('browsers cannot record shipments or tracking', () => as(STAFF, 'aal2', `select apply_tracking('x','DELIVERED',now(),'',null,false,'{}')`), errored('permission'));
await svc(`select record_shipment($1, 'SR1', 'SH1', 'AWB111', 'Delhivery Surface', 'https://labels.example/1.pdf')`, [i1.order_id]);
await expect('booking moves the order to Processing with tracking', () => one(`select status, awb, tracking_url, courier from orders where id=$1`, [i1.order_id]).then((x) => ({ rows: [x] })),
  (r) => r.rows[0].status === 'Processing' && r.rows[0].awb === 'AWB111' && r.rows[0].tracking_url === 'https://shiprocket.co/tracking/AWB111' && r.rows[0].courier === 'Delhivery Surface');
const track = (awb, st, at, extra = {}) => svc(`select apply_tracking($1,$2,$3::timestamptz,$4,$5::timestamptz,$6,$7::jsonb) r`, [awb, st, at, extra.loc || 'Pune Hub', extra.etd || null, !!extra.ret, J({ awb, current_status: st })]).then((x) => x.rows[0].r);
await expect('picked up: order Shipped', () => track('AWB111', 'Picked Up', '2026-11-12T10:00:00+05:30', { etd: '2026-11-15T18:00:00+05:30' }).then((r) => ({ rows: [r] })), (r) => r.rows[0].moved === 'Shipped');
await expect('shipping issued the invoice automatically', () => one(`select number, data from invoices where order_id=$1`, [i1.order_id]).then((x) => ({ rows: [x] })), (r) => /^VRT\/\d\d-\d\d\/0001$/.test(r.rows[0]?.number));
await expect('in-state GST: CGST + SGST, worked back from inclusive prices', () => one(`select data from invoices where order_id=$1`, [i1.order_id]).then((x) => ({ rows: [x.data] })), (r) => {
  const d = r.rows[0]; const bag = d.lines[0]; const ship = d.lines[1];
  return d.title === 'Tax invoice' && d.intra_state && bag.hsn === '4202' && Number(bag.taxable) === 2117.80 && Number(bag.cgst) === 190.60 && Number(bag.sgst) === 190.60
    && ship.description === 'Shipping and handling' && Number(ship.taxable) === 83.90 && Number(d.totals.total) === 2598 && Number(d.totals.igst) === 0
    && Math.abs(Number(d.totals.taxable) + Number(d.totals.cgst) + Number(d.totals.sgst) - 2598) < 0.001;
});
await expect('the shipped email went out with tracking', async () => ({ rows: await outbox(`kind='order_shipped' and related_order='${i1.order_id}'`) }), (r) => r.rows.length === 1 && r.rows[0].payload.tracking_number === 'AWB111');
await expect('estimated delivery stored', () => one(`select eta, ship_status from orders where id=$1`, [i1.order_id]).then((x) => ({ rows: [x] })), (r) => r.rows[0].ship_status === 'PICKED UP' && String(r.rows[0].eta.toISOString?.() || r.rows[0].eta).startsWith('2026-11-15'));
await track('AWB111', 'Out For Delivery', '2026-11-15T09:00:00+05:30');
await track('AWB111', 'Out for delivery', '2026-11-15T09:05:00+05:30');
await expect('out-for-delivery email once', async () => ({ rows: await outbox(`kind='order_out_for_delivery' and related_order='${i1.order_id}'`) }), (r) => r.rows.length === 1);
await expect('an older event arriving late changes nothing', () => track('AWB111', 'In Transit', '2026-11-13T09:00:00+05:30').then((r) => ({ rows: [r] })), (r) => r.rows[0].stale === true);
await expect('delivered: order Delivered with a date', async () => { await track('AWB111', 'DELIVERED', '2026-11-15T14:00:00+05:30'); return one(`select status, delivered_at, payment_status from orders where id=$1`, [i1.order_id]).then((x) => ({ rows: [x] })); }, (r) => r.rows[0].status === 'Delivered' && r.rows[0].delivered_at);
await expect('tracking timeline kept', () => db.query(`select status from shipment_events where order_id=$1 order by at`, [i1.order_id]), (r) => r.rows.map((x) => x.status).join('>') === 'PICKED UP>IN TRANSIT>OUT FOR DELIVERY>OUT FOR DELIVERY>DELIVERED');
await expect('unknown tracking numbers are ignored', () => track('NOPE', 'DELIVERED', '2026-11-15T14:00:00+05:30').then((r) => ({ rows: [r] })), (r) => r.rows[0].error === 'unknown_awb');
const i2 = await paidOrder([{ sku: 'VRT-SL-COB', qty: 2 }, { sku: 'VRT-MS-TEA', qty: 1 }], 'WELCOME10', delhi);
await svc(`select record_shipment($1, 'SR2', 'SH2', 'AWB222', 'Bluedart', null)`, [i2.order_id]);
await expect('returned to origin is flagged', async () => { await track('AWB222', 'RTO Initiated', '2026-11-16T10:00:00+05:30'); return one(`select flag from orders where id=$1`, [i2.order_id]).then((x) => ({ rows: [x] })); }, (r) => r.rows[0].flag === 'returning_to_us: rto initiated');
await expect('inter-state GST: IGST, discount spread over lines', async () => { await as(STAFF, 'aal2', `select create_invoice($1)`, [i2.order_id]); return one(`select number, data from invoices where order_id=$1`, [i2.order_id]).then((x) => ({ rows: [x] })); }, (r) => {
  const d = r.rows[0].data; const goods = d.lines.filter((l) => l.sku);
  const disc = goods.reduce((n, l) => n + Number(l.discount), 0);
  return /0002$/.test(r.rows[0].number) && !d.intra_state && Number(d.totals.cgst) === 0 && Number(d.totals.igst) > 0 && Math.abs(disc - i2.quote.discount) < 0.001 && Number(d.totals.total) === i2.total;
});
await expect('invoice numbers never repeat', () => as(STAFF, 'aal2', `select create_invoice($1) r`, [i2.order_id]), (r) => r.rows[0].r.existing === true);
await expect('buyer reads the invoice with the order link', () => as(null, null, `select invoice_lookup($1, $2) a, invoice_lookup($1, gen_random_uuid()) b`, [i2.order_id, i2.access_token]), (r) => r.rows[0].a?.number && r.rows[0].b === null);
await expect('others cannot read invoices', () => as(OTHER, 'aal1', `select * from invoices`), rows(0));
await db.exec(`update settings set gst_registered = false`);
await expect('not registered: plain invoice without tax', async () => { const o = await paidOrder([{ sku: 'VRT-LP-BLA', qty: 1 }], null, pune); await as(STAFF, 'aal2', `select create_invoice($1)`, [o.order_id]); return one(`select data from invoices where order_id=$1`, [o.order_id]).then((x) => ({ rows: [x.data] })); },
  (r) => r.rows[0].title === 'Invoice' && Number(r.rows[0].totals.cgst) + Number(r.rows[0].totals.igst) === 0 && Number(r.rows[0].lines[0].taxable) === 2499);
await db.exec(`update settings set gst_registered = true`);

// returns
const tokenOf = async (id) => (await one(`select access_token from orders where id=$1`, [id])).access_token;
const ret = (id, token, items, reason = 'damaged') => as(null, null, `select request_return($1, $2, $3::jsonb, $4, 'Strap stitching came loose') r`, [id, token, J(items), reason]).then((x) => x.rows[0].r);
await expect('returns need a delivered order', async () => ({ rows: [await ret(i2.order_id, i2.access_token, [{ sku: 'VRT-SL-COB', qty: 1 }])] }), (r) => r.rows[0].error === 'not_delivered');
await expect('wrong link finds nothing', async () => ({ rows: [await ret(i1.order_id, '00000000-0000-0000-0000-000000000000', [{ sku: 'VRT-LP-BLA', qty: 1 }])] }), (r) => r.rows[0].error === 'not_found');
await expect('cannot return more than was bought', async () => ({ rows: [await ret(i1.order_id, await tokenOf(i1.order_id), [{ sku: 'VRT-LP-BLA', qty: 2 }])] }), (r) => r.rows[0].error === 'bad_items');
let rid;
await expect('return requested', async () => { const r = await ret(i1.order_id, await tokenOf(i1.order_id), [{ sku: 'VRT-LP-BLA', qty: 1 }]); rid = r.id; return { rows: [r] }; }, (r) => r.rows[0].ok);
await expect('...and acknowledged to buyer and store', async () => ({ rows: (await outbox(`dedupe_key like '%return%:${rid}'`)).map((x) => x.kind) }), (r) => r.rows.sort().join() === 'admin_return,return_requested');
await expect('the same bag cannot be returned twice', async () => ({ rows: [await ret(i1.order_id, await tokenOf(i1.order_id), [{ sku: 'VRT-LP-BLA', qty: 1 }])] }), (r) => r.rows[0].error === 'bad_items');
await expect('buyer sees the request on the order page', async () => as(null, null, `select order_returns($1, $2) r`, [i1.order_id, await tokenOf(i1.order_id)]), (r) => r.rows[0].r[0].status === 'requested');
await expect('shoppers cannot approve returns', () => as(OTHER, 'aal1', `select decide_return(${rid}, true, '')`), errored('not_allowed'));
await expect('staff approve, buyer told', async () => { await as(STAFF, 'aal2', `select decide_return(${rid}, true, 'Sorry about that. A courier will collect it.')`); return { rows: await outbox(`kind='return_approved'`) }; }, (r) => r.rows.length === 1 && r.rows[0].payload.admin_note.startsWith('Sorry'));
await svc(`select set_return_pickup(${rid}, 'RAWB1')`);
await track('RAWB1', 'Picked Up', '2026-11-17T10:00:00+05:30', { ret: true });
await expect('return pickup tracked', () => one(`select status from return_requests where id=${rid}`).then((x) => ({ rows: [x] })), (r) => r.rows[0].status === 'in_transit');
await track('RAWB1', 'Delivered', '2026-11-19T10:00:00+05:30', { ret: true });
const blaBefore = await stock('VRT-LP-BLA');
await expect('received: restocked and refund suggested', async () => ({ rows: [(await as(STAFF, 'aal2', `select receive_return(${rid}) r`)).rows[0].r] }), (r) => r.rows[0].refund_amount === 2499);
await expect('only the returned items went back on the shelf', async () => ({ rows: [{ s: await stock('VRT-LP-BLA') }] }), (r) => r.rows[0].s === blaBefore + 1);
await expect('closed as refunded', async () => { await as(STAFF, 'aal2', `select close_return(${rid}, true)`); return one(`select status from return_requests where id=${rid}`).then((x) => ({ rows: [x] })); }, (r) => r.rows[0].status === 'refunded');
await expect('return window closes', async () => {
  const o = await paidOrder([{ sku: 'VRT-LP-BLA', qty: 1 }], null, pune);
  await svc(`select record_shipment($1, 'SR3', 'SH3', 'AWB333', 'X', null)`, [o.order_id]);
  await track('AWB333', 'Delivered', '2026-11-01T10:00:00+05:30');
  await db.exec(`update orders set delivered_at = now() - interval '8 days' where id='${o.order_id}'`);
  return { rows: [await ret(o.order_id, o.access_token, [{ sku: 'VRT-LP-BLA', qty: 1 }])] };
}, (r) => r.rows[0].error === 'window_closed');
await expect('order page shows tracking, invoice and return deadline', async () => as(null, null, `select order_lookup($1, $2) r`, [i1.order_id, await tokenOf(i1.order_id)]), (r) => {
  const o = r.rows[0].r; return o.events.length === 5 && /^VRT\//.test(o.invoice) && o.return_until && o.courier === 'Delhivery Surface';
});

// ---------------------------------------------------------------- Phase 6: compliance
await db.exec(`update settings set grievance_name = 'Veda Shah', grievance_email = 'grievance@vertu.test', grievance_phone = '+919769245614',
  care_email = 'care@vertu.test', care_phone = '+919769245614', registered_address = '12 Studio Lane, Bandra, Mumbai 400050'`);
await expect('legal details are public, internal settings are not', () => as(null, null, `select legal_info() r`), (r) => {
  const x = r.rows[0].r; return x.grievance_name === 'Veda Shah' && x.registered_address.startsWith('12') && !('notify_email' in x) && !('pickup_pin' in x);
});
await expect('collections carry listing declarations', () => db.query(`select declarations from categories where id='laptop'`), (r) => r.rows[0].declarations.country_of_origin === 'India' && r.rows[0].declarations.generic_name === 'Laptop Bag');
await expect('price cannot exceed MRP', () => as(STAFF, 'aal2', `update products set mrp = 100 where id='VRT-LP-CRI'`), errored('check'));
await expect('MRP at or above price is fine', () => as(STAFF, 'aal2', `update products set mrp = 2999 where id='VRT-LP-CRI' returning mrp`), rows(1));
await db.exec(`delete from email_outbox`);
let tk;
await expect('anyone can raise a ticket and gets a number', async () => { tk = (await as(null, null, `select open_ticket('Ravi Shah', 'Ravi@Example.com', '98765 43210', 'vrt-10501', 'delivery', 'My parcel says delivered but I have not received it.') r`)).rows[0].r; return { rows: [tk] }; }, (r) => r.rows[0].ok && /^VRT-T-\d+$/.test(r.rows[0].number));
await expect('acknowledgement with a copy goes out at once; grievance officer alerted', async () => ({ rows: await outbox(`true`) }), (r) => {
  const ack = r.rows.find((x) => x.kind === 'ticket_received'); const adm = r.rows.find((x) => x.kind === 'admin_ticket');
  return ack?.to_email === 'ravi@example.com' && ack.payload.message.includes('not received') && ack.payload.number === tk.number && adm?.to_email === 'grievance@vertu.test';
});
await expect('ticket due within a month, phone normalised', () => db.query(`select due_at - created_at as d, phone, order_id from support_tickets where number=$1`, [tk.number]), (r) => String(r.rows[0].d?.days ?? r.rows[0].d).startsWith('30') && r.rows[0].phone === '+919876543210' && r.rows[0].order_id === 'VRT-10501');
await expect('too-short messages refused', () => as(null, null, `select open_ticket('A', 'a@b.co', '', null, 'other', 'hi') r`), (r) => r.rows[0].r.error === 'too_short');
await expect('five tickets a day per email', async () => {
  for (const n of ['one', 'two', 'three', 'four', 'five']) await as(null, null, `select open_ticket('A', 'spam@example.com', '', null, 'other', 'Message number ${n} here')`);
  return as(null, null, `select open_ticket('A', 'SPAM@example.com', '', null, 'other', 'Sixth message here') r`);
}, (r) => r.rows[0].r.error === 'too_many');
await expect('tickets are private', () => as(OTHER, 'aal1', `select * from support_tickets`), rows(0));
await expect('staff see tickets', () => as(STAFF, 'aal2', `select * from support_tickets where number=$1`, [tk.number]), rows(1));
await expect('shoppers cannot reply', () => as(OTHER, 'aal1', `select reply_ticket(1, 'x', 'closed')`), errored('not_allowed'));
await expect('staff reply is emailed and closing records the time', async () => {
  const id = (await one(`select id from support_tickets where number=$1`, [tk.number])).id;
  await as(STAFF, 'aal2', `select reply_ticket(${id}, 'Sorry! The courier left it with your security desk. We have called them.', 'closed')`);
  return { rows: [await one(`select status, resolved_at, last_reply from support_tickets where id=${id}`), (await outbox(`kind='ticket_reply'`))[0]] };
}, (r) => r.rows[0].status === 'closed' && r.rows[0].resolved_at && r.rows[1]?.payload.reply.startsWith('Sorry'));

const NEW = '00000000-0000-0000-0000-00000000000e';
await db.exec(`insert into auth.users (id, email) values ('${NEW}', 'leaving@example.com')`);
await as(NEW, 'aal1', `insert into addresses (full_name, phone, line1, city, state, pin) values ('Leaving', '+919811100000', '1 Road', 'Pune', 'Maharashtra', '411001')`);
await as(NEW, 'aal1', `update profiles set marketing_opt_in = true where id='${NEW}'`);
await db.query(`update orders set customer_id=$1 where id=$2`, [NEW, i2.order_id]);
let dr;
await expect('a privacy request is acknowledged and the owner alerted', async () => { dr = (await as(NEW, 'aal1', `insert into data_requests (email, kind) values ('leaving@example.com', 'delete') returning id`)).rows[0].id; return { rows: (await outbox(`dedupe_key like 'privacy_received:${dr}' or dedupe_key like 'admin_privacy:${dr}'`)).map((x) => x.kind) }; }, (r) => r.rows.sort().join() === 'admin_privacy,privacy_received');
await expect('export gathers everything held about the person', () => svc(`select personal_data_export($1) r`, [NEW]), (r) => { const x = r.rows[0].r; return x.account.email === 'leaving@example.com' && x.addresses.length === 1 && x.orders.some((o) => o.id === i2.order_id) && x.newsletter.status === 'subscribed'; });
await expect('browsers cannot export or erase', () => as(OWNER, 'aal2', `select personal_data_export('${NEW}')`), errored('permission'));
await expect('erasure removes account data but keeps tax records detached', async () => {
  await svc(`select personal_data_erase($1)`, [NEW]);
  return { rows: [await one(`select (select count(*) from addresses where user_id='${NEW}')::int a, (select count(*) from profiles where id='${NEW}')::int p,
    (select count(*) from newsletter_subscribers where email='leaving@example.com')::int n, (select customer_id from orders where id='${i2.order_id}') c,
    (select count(*) from invoices where order_id='${i2.order_id}')::int i`)] };
}, (r) => r.rows[0].a === 0 && r.rows[0].p === 0 && r.rows[0].n === 0 && r.rows[0].c === null && r.rows[0].i === 1);
await expect('staff cannot close privacy requests', () => as(STAFF, 'aal2', `select resolve_data_request(${dr}, 'done')`), errored('not_allowed'));
await expect('owner closes it and the person is told', async () => { await as(OWNER, 'aal2', `select resolve_data_request(${dr}, 'Account and personal details deleted. Order records kept for tax law.')`); return { rows: await outbox(`kind='privacy_done'`) }; }, (r) => r.rows.length === 1 && r.rows[0].to_email === 'leaving@example.com');
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

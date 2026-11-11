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
  const claims = JSON.stringify(who ? { sub: who, role, aal } : { role });
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
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

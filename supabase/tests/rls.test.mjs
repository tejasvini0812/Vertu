// Runs the real migration + seed in an in-process Postgres (PGlite) with minimal Supabase stubs,
// then checks what shoppers, staff (with and without two-step verification) and owners can do.
// Run: npm run test:db
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
const R = new URL('../', import.meta.url).pathname;
const db = new PGlite();
await db.exec(readFileSync(new URL('./supabase-stubs.sql', import.meta.url), 'utf8'));
await db.exec(readFileSync(R + 'migrations/20261112000000_phase1_core.sql', 'utf8'));
await db.exec(readFileSync(R + 'seed.sql', 'utf8'));
await db.exec(readFileSync(R + 'seed.sql', 'utf8')); // idempotent
await db.exec(readFileSync(R + 'sample_orders.sql', 'utf8'));
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
    const ok = check(null, e);
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
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

// Generates supabase/seed.sql (catalogue + editorial) and supabase/sample_orders.sql (optional, staging only)
// from src/seed.js, so the database starts with exactly what the demo shows.
import { writeFileSync } from 'node:fs';
import { seed, CATEGORIES } from '../src/seed.js';

const q = (v) => (v === null || v === undefined ? 'null' : `'${String(v).replace(/'/g, "''")}'`);
const s = seed(Date.parse('2026-11-12T06:00:00Z'));

let out = `-- Starting catalogue and editorial content. Safe to run more than once.\n\n`;
out += `insert into public.categories (id, name, code, unit, sort) values\n`;
out += CATEGORIES.map((c, i) => `  (${q(c.id)}, ${q(c.name)}, ${q(c.code)}, ${q(c.unit)}, ${i})`).join(',\n');
out += `\non conflict (id) do nothing;\n\n`;
out += `insert into public.products (id, category, colour, hex, price, stock, status, image, description, sort) values\n`;
out += s.products
  .map((p, i) => `  (${[p.id, p.category, p.colour, p.hex].map(q).join(', ')}, ${p.price}, ${p.stock}, ${q(p.status)}, ${q(p.image)}, ${q(p.description)}, ${i})`)
  .join(',\n');
out += `\non conflict (id) do nothing;\n\n`;
const content = { ...s.content };
delete content.publishedAt;
delete content.published_at;
out += `insert into public.site_content (id, published) values (1, ${q(JSON.stringify(content))}::jsonb)\non conflict (id) do nothing;\n\n`;
out += `insert into public.settings (id, low_stock) values (1, ${s.settings.lowStock})\non conflict (id) do nothing;\n`;
writeFileSync(new URL('../supabase/seed.sql', import.meta.url), out);

let o = `-- OPTIONAL sample orders for a staging project. Do not run on production.\n-- Invented customers (example.com addresses). Delete with: delete from public.orders where customer_email like '%@example.com';\n\n`;
for (const ord of s.orders) {
  const c = ord.customer;
  o += `insert into public.orders (id, created_at, status, customer_name, customer_email, customer_phone, ship_address, ship_city, ship_state, ship_pin)\n`;
  o += `values (${q(ord.id)}, now() - interval '${Math.round((Date.parse('2026-11-12T06:00:00Z') - ord.createdAt) / 60000)} minutes', ${q(ord.status)}, ${[c.name, c.email, c.phone, c.address, c.city, c.state, c.pin].map(q).join(', ')})\non conflict (id) do nothing;\n`;
  o += `insert into public.order_items (order_id, sku, category, colour, price, qty) values\n`;
  o += ord.lines.map((l) => `  (${q(ord.id)}, ${q(l.sku)}, ${q(l.category)}, ${q(l.colour)}, ${l.price}, ${l.qty})`).join(',\n') + `;\n\n`;
}
writeFileSync(new URL('../supabase/sample_orders.sql', import.meta.url), o);
console.log(`seed.sql: ${s.products.length} products; sample_orders.sql: ${s.orders.length} orders`);

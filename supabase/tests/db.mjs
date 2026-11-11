// Builds an in-process Postgres (PGlite) with Supabase stand-ins, every migration, the seed and sample orders.
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';

const R = new URL('../', import.meta.url).pathname;
export const USERS = {
  owner: '00000000-0000-0000-0000-00000000000a',
  staff: '00000000-0000-0000-0000-00000000000b',
  shopper: '00000000-0000-0000-0000-00000000000c',
};

export async function makeDb() {
  const db = new PGlite();
  await db.exec(readFileSync(new URL('./supabase-stubs.sql', import.meta.url), 'utf8'));
  for (const f of readdirSync(R + 'migrations').sort()) await db.exec(readFileSync(R + 'migrations/' + f, 'utf8'));
  await db.exec(readFileSync(R + 'seed.sql', 'utf8'));
  await db.exec(readFileSync(R + 'sample_orders.sql', 'utf8'));
  await db.exec(`insert into public.profiles (id) select id from auth.users on conflict do nothing;
    insert into public.admin_users (user_id, role) values ('${USERS.owner}','owner'), ('${USERS.staff}','staff');`);
  return db;
}

/** Call a public.* function as the service role with named arguments, like supabase-js admin.rpc(). */
export function serviceRpc(db) {
  return async (name, args = {}) => {
    const keys = Object.keys(args);
    const sql = `select public.${name}(${keys.map((k, i) => `${k} => $${i + 1}`).join(', ')}) as r`;
    const vals = keys.map((k) => (args[k] !== null && typeof args[k] === 'object' ? JSON.stringify(args[k]) : args[k]));
    return db.transaction(async (tx) => {
      await tx.query(`select set_config('request.jwt.claims', '{"role":"service_role"}', true)`);
      await tx.query('set local role service_role');
      return (await tx.query(sql, vals)).rows[0].r;
    });
  };
}

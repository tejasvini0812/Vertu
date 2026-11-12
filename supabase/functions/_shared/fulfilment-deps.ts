// Database access for the shipping functions (service role).
import { admin } from './http.ts';
// @ts-ignore shared JS
import { shiprocketClient } from './shiprocket.js';

const one = async (q: PromiseLike<{ data: unknown; error: { message: string } | null }>) => {
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data as any;
};

export const db = {
  order: (id: string) => one(admin.from('orders').select('*').eq('id', id).maybeSingle()),
  items: (id: string) => one(admin.from('order_items').select('*').eq('order_id', id).order('id')),
  settings: () => one(admin.from('settings').select('*').eq('id', 1).single()),
  categories: () => one(admin.from('categories').select('*')),
  ret: (id: number) => one(admin.from('return_requests').select('*').eq('id', id).maybeSingle()),
};

export const sr = shiprocketClient({
  email: Deno.env.get('SHIPROCKET_EMAIL'),
  password: Deno.env.get('SHIPROCKET_PASSWORD'),
  tokenStore: {
    get: async () => (await admin.from('integration_tokens').select('token, expires_at').eq('name', 'shiprocket').maybeSingle()).data,
    set: async (token: string, expires_at: string) => {
      await admin.from('integration_tokens').upsert({ name: 'shiprocket', token, expires_at });
    },
  },
});

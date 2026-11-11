// Small helpers for the Edge Functions: CORS, JSON replies, Supabase clients and dependencies.
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
// @ts-ignore plain JS module shared with the Node tests
import { razorpayClient } from './payments.js';

const ALLOWED = (Deno.env.get('ALLOWED_ORIGINS') || '*').split(',').map((s) => s.trim()).filter(Boolean);

export function cors(req: Request): Record<string, string> {
  const origin = req.headers.get('Origin') || '';
  const allow = ALLOWED.includes('*') ? '*' : ALLOWED.includes(origin) ? origin : ALLOWED[0];
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  };
}

export const json = (req: Request, status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors(req), 'Content-Type': 'application/json' } });

export const admin: SupabaseClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

/** A client acting as the caller (their JWT), for "who is this?" and role checks. */
export function asCaller(req: Request): SupabaseClient {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') || '' } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function rpc(name: string, args: Record<string, unknown>) {
  const { data, error } = await admin.rpc(name, args);
  if (error) throw new Error(`${name}: ${error.message}`);
  return data;
}

export async function getOrder(id: string) {
  const { data, error } = await admin.from('orders').select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

export const rzp = razorpayClient(Deno.env.get('RAZORPAY_KEY_ID'), Deno.env.get('RAZORPAY_KEY_SECRET'));

export const deps = {
  rpc,
  getOrder,
  rzp,
  keyId: Deno.env.get('RAZORPAY_KEY_ID') || '',
  keySecret: Deno.env.get('RAZORPAY_KEY_SECRET') || '',
  webhookSecret: Deno.env.get('RAZORPAY_WEBHOOK_SECRET') || '',
  now: () => new Date(),
};

/** Wraps a handler with CORS preflight, method check and error reporting (no internals leak to the browser). */
export function serve(handler: (req: Request) => Promise<Response>) {
  Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(req) });
    if (req.method !== 'POST') return json(req, 405, { error: 'method_not_allowed' });
    try {
      return await handler(req);
    } catch (e) {
      console.error(e);
      return json(req, 500, { error: 'server_error' });
    }
  });
}

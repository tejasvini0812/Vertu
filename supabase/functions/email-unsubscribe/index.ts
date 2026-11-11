// One-click unsubscribe (RFC 8058): email apps POST here when someone presses "Unsubscribe".
import { cors } from '../_shared/http.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(req) });
  const t = new URL(req.url).searchParams.get('t') || '';
  const site = (Deno.env.get('SITE_URL') || '').replace(/\/$/, '');
  if (req.method === 'GET') return Response.redirect(`${site}/newsletter/?unsubscribe=${encodeURIComponent(t)}`, 302);
  if (req.method !== 'POST' || !UUID.test(t)) return new Response('Bad request', { status: 400 });
  await db.rpc('unsubscribe_newsletter', { p_token: t });
  return new Response('Unsubscribed', { status: 200, headers: { 'Content-Type': 'text/plain' } });
});

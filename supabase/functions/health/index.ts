// Public uptime check for a monitor such as UptimeRobot or Better Stack: GET (or POST) /functions/v1/health.
// 200 {"ok":true,...} when the database answers and emails are flowing; 503 otherwise. Reveals no data.
import { admin } from '../_shared/http.ts';

Deno.serve(async (req) => {
  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' };
  if (req.method === 'OPTIONS') return new Response('ok', { headers });
  const started = Date.now();
  try {
    const { data, error } = await admin.rpc('health_ping');
    if (error) throw new Error(error.message);
    const ok = data.email_backlog < 50;
    const body = {
      ok,
      db: true,
      email_backlog: data.email_backlog,
      emails_failed: data.emails_failed,
      cors_locked: !!Deno.env.get('ALLOWED_ORIGINS') && Deno.env.get('ALLOWED_ORIGINS') !== '*',
      ms: Date.now() - started,
    };
    return new Response(JSON.stringify(body), { status: ok ? 200 : 503, headers });
  } catch (_) {
    return new Response(JSON.stringify({ ok: false, db: false }), { status: 503, headers });
  }
});

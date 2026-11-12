// Courier tracking updates from Shiprocket.
// In Shiprocket: Settings -> API -> Webhooks: URL = https://<ref>.supabase.co/functions/v1/courier-updates,
// token = SHIPROCKET_WEBHOOK_TOKEN (Shiprocket sends it back in the x-api-key header).
// (Named "courier-updates" because Shiprocket rejects webhook URLs containing "shiprocket", "sr" or "kr".)
import { serve, json, rpc } from '../_shared/http.ts';
// @ts-ignore shared JS
import { handleShiprocketWebhook } from '../_shared/shiprocket.js';

serve(async (req) => {
  const body = await req.json().catch(() => null);
  const r = await handleShiprocketWebhook(body, req.headers.get('x-api-key'), { rpc, webhookToken: Deno.env.get('SHIPROCKET_WEBHOOK_TOKEN') || '' });
  return json(req, r.status, r.body);
});

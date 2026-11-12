// Public: "when would this reach PIN 400050?" Uses Shiprocket's courier serviceability, cached a day per PIN.
import { serve, json, admin } from '../_shared/http.ts';
import { sr } from '../_shared/fulfilment-deps.ts';
// @ts-ignore shared JS
import { handleDeliveryEstimate } from '../_shared/shiprocket.js';

serve(async (req) => {
  const { data: s } = await admin.from('settings').select('pickup_pin').eq('id', 1).single();
  const r = await handleDeliveryEstimate(await req.json().catch(() => null), {
    sr,
    pickupPin: s?.pickup_pin,
    getCache: async (pin: string) => (await admin.from('pin_estimates').select('*').eq('pin', pin).maybeSingle()).data,
    setCache: async (row: Record<string, unknown>) => {
      await admin.from('pin_estimates').upsert(row);
    },
  });
  return json(req, r.status, r.body);
}, { name: 'delivery-estimate', limit: { max: 40, windowSeconds: 600 } });

// Called by the checkout page after Razorpay reports success. Checks Razorpay's signature,
// confirms the payment with Razorpay's API (and captures it if needed), then marks the order paid.
import { serve, json, deps } from '../_shared/http.ts';
// @ts-ignore shared JS
import { handleVerify } from '../_shared/payments.js';

serve(async (req) => {
  if (!deps.rzp) return json(req, 503, { error: 'payments_not_configured' });
  const r = await handleVerify(await req.json().catch(() => null), deps);
  return json(req, r.status, r.body);
}, { name: 'payment-verify', limit: { max: 30, windowSeconds: 600 } });

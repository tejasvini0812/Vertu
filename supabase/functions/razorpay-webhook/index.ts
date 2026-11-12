// Razorpay -> us. The safety net if a shopper closes the tab before the checkout page confirms:
// payment.captured / order.paid mark the order paid; payment.failed is noted. Signed with the webhook secret.
import { serve, json, deps } from '../_shared/http.ts';
// @ts-ignore shared JS
import { handleWebhook } from '../_shared/payments.js';

serve(async (req) => {
  const raw = await req.text();
  const r = await handleWebhook(raw, req.headers.get('X-Razorpay-Signature') || '', deps);
  return json(req, r.status, r.body);
}, { name: 'razorpay-webhook' });

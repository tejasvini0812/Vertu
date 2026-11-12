// Creates an order from the shopper's bag (prices and stock checked in the database) and,
// for online payment, a matching Razorpay order. Guests and signed-in shoppers can both call it.
import { serve, json, deps, asCaller } from '../_shared/http.ts';
// @ts-ignore shared JS
import { handleCheckout } from '../_shared/payments.js';

serve(async (req) => {
  const body = await req.json().catch(() => null);
  let user = null;
  if ((req.headers.get('Authorization') || '').startsWith('Bearer ')) {
    const { data } = await asCaller(req).auth.getUser();
    user = data?.user ? { id: data.user.id, email: data.user.email } : null;
  }
  const r = await handleCheckout(body, { ...deps, user });
  return json(req, r.status, r.body);
}, { name: 'checkout', limit: { max: 30, windowSeconds: 600 } });

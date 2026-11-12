// Owner actions on an order: cancel (restock, refund anything paid online) or refund part/all of a payment.
// The caller must be an owner with a two-step-verified session (checked in the database via admin_role()).
import { serve, json, deps, asCaller } from '../_shared/http.ts';
// @ts-ignore shared JS
import { handleAdminOrder } from '../_shared/payments.js';

serve(async (req) => {
  const caller = asCaller(req);
  const { data: u } = await caller.auth.getUser();
  if (!u?.user) return json(req, 401, { error: 'sign_in' });
  const { data: role } = await caller.rpc('admin_role');
  const r = await handleAdminOrder(await req.json().catch(() => null), { ...deps, role, actor: u.user.id });
  return json(req, r.status, r.body);
}, { name: 'admin-order' });

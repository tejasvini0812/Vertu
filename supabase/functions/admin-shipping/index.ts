// Staff shipping actions: courier rates, book (order + AWB + label + pickup + invoice), relabel, cancel, sync tracking,
// and reverse pickups for approved returns. Caller must be staff/owner with two-step verification.
import { serve, json, rpc, asCaller } from '../_shared/http.ts';
import { db, sr } from '../_shared/fulfilment-deps.ts';
// @ts-ignore shared JS
import { handleAdminShipping } from '../_shared/shiprocket.js';

serve(async (req) => {
  const caller = asCaller(req);
  const { data: u } = await caller.auth.getUser();
  if (!u?.user) return json(req, 401, { error: 'sign_in' });
  const { data: role } = await caller.rpc('admin_role');
  try {
    const r = await handleAdminShipping(await req.json().catch(() => null), { role, rpc, sr, db });
    return json(req, r.status, r.body);
  } catch (e) {
    // Shiprocket's own message is useful to staff (e.g. "Pincode not serviceable")
    const err = e as { code?: string; message?: string };
    if (err.code === 'shiprocket') return json(req, 502, { error: 'shiprocket', message: err.message });
    throw e;
  }
}, { name: 'admin-shipping' });

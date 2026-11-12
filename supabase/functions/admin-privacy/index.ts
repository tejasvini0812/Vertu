// Owner actions on privacy requests (DPDP): export a person's data as JSON, or erase their account.
// Erasure deletes account data, then the Supabase Auth user. Orders and invoices are kept (tax law) but detached.
import { serve, json, rpc, admin, asCaller } from '../_shared/http.ts';

serve(async (req) => {
  const caller = asCaller(req);
  const { data: u } = await caller.auth.getUser();
  if (!u?.user) return json(req, 401, { error: 'sign_in' });
  const { data: role } = await caller.rpc('admin_role');
  if (role !== 'owner') return json(req, 403, { error: 'owners_only' });

  const body = await req.json().catch(() => ({}));
  const { data: r } = await admin.from('data_requests').select('*').eq('id', Number(body?.request_id)).maybeSingle();
  if (!r) return json(req, 404, { error: 'unknown_request' });
  const userId = r.user_id as string | null;
  if (!userId) return json(req, 409, { error: 'no_account' }); // account already gone

  if (body.action === 'export') {
    const data = await rpc('personal_data_export', { p_user: userId });
    return json(req, 200, { data });
  }
  if (body.action === 'erase') {
    if (u.user.id === userId) return json(req, 409, { error: 'cannot_erase_self' });
    const res = await rpc('personal_data_erase', { p_user: userId });
    if (!res?.ok) return json(req, 409, res);
    const { error } = await admin.auth.admin.deleteUser(userId);
    if (error) return json(req, 502, { error: 'auth_delete_failed', message: error.message });
    return json(req, 200, { erased: true });
  }
  return json(req, 400, { error: 'bad_action' });
}, { name: 'admin-privacy' });

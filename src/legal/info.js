import { LIVE, supabase } from '../lib/supabase.js';
import { getState } from '../store.js';

/** Business facts for the policy pages: from the database (live) or the sample settings (demo). */
export async function legalInfo() {
  if (LIVE) {
    const { data } = await supabase.rpc('legal_info');
    if (data) return withDefaults(data);
  }
  const s = getState().settings;
  return withDefaults({
    legal_name: s.legalName, gstin: s.gstin, registered_address: s.registeredAddress, business_address: s.businessAddress,
    business_city: s.businessCity, business_state: s.businessState, care_email: s.careEmail, care_phone: s.carePhone, care_hours: s.careHours,
    grievance_name: s.grievanceName, grievance_title: s.grievanceTitle, grievance_email: s.grievanceEmail, grievance_phone: s.grievancePhone,
    return_window_days: s.returnWindowDays, return_shipping_fee: s.returnShippingFee, dispatch_days: s.dispatchDays,
    shipping_fee: s.shippingFee, free_shipping_over: s.freeShippingOver, cod_enabled: s.codEnabled, cod_fee: s.codFee, cod_max: s.codMax,
    hold_minutes: s.holdMinutes, policies_updated_at: s.policiesUpdatedAt, dark_patterns_audit_date: s.darkPatternsAudit?.date,
  });
}

const FALLBACK_EMAIL = 'contact.shopvertu@gmail.com';
function withDefaults(x) {
  const care = x.care_email || FALLBACK_EMAIL;
  return {
    ...x,
    name: x.legal_name || 'VERTU',
    care_email: care,
    care_hours: x.care_hours || 'Monday to Saturday, 10am to 6pm',
    grievance_title: x.grievance_title || 'Grievance Officer',
    grievance_email: x.grievance_email || care,
    address: x.registered_address || [x.business_address, x.business_city, x.business_state].filter(Boolean).join(', '),
    city: x.business_city || 'Mumbai',
    return_window_days: x.return_window_days ?? 7,
    dispatch_days: x.dispatch_days ?? 2,
  };
}

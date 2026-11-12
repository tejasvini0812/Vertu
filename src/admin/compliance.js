// What the law asks the store to show, checked against current settings. Not legal advice.
export const DARK_PATTERNS = [
  ['false_urgency', 'False urgency', '“Only N left” shows real stock; there are no fake countdowns or invented demand.'],
  ['basket_sneaking', 'Basket sneaking', 'Nothing is added to the bag or total without the shopper choosing it.'],
  ['confirm_shaming', 'Confirm shaming', 'No guilt-tripping copy on declining or leaving.'],
  ['forced_action', 'Forced action', 'Guest checkout; no forced sign-up, newsletter or app download to buy.'],
  ['subscription_trap', 'Subscription trap', 'No subscriptions. Newsletter unsubscribes in one click.'],
  ['interface_interference', 'Interface interference', 'Choices (payment method, privacy, consent) are shown evenly; nothing pre-ticked for marketing.'],
  ['bait_and_switch', 'Bait and switch', 'The price and item shown are what is charged and sent; checkout re-checks stock and explains any change.'],
  ['drip_pricing', 'Drip pricing', 'Shipping and cash fees are shown at checkout before payment; nothing is added afterwards.'],
  ['disguised_advertisement', 'Disguised advertisement', 'No paid placements or sponsored listings.'],
  ['nagging', 'Nagging', 'No repeated pop-ups. The privacy banner shows once, and only when there is a choice to make.'],
  ['trick_question', 'Trick question', 'Plain wording on consent and cancellation; no double negatives.'],
  ['saas_billing', 'SaaS billing', 'No recurring charges.'],
  ['rogue_malware', 'Rogue malware', 'No third-party scripts except Razorpay checkout (and analytics if added, only with consent).'],
];

/** [label, done, hint] for the compliance checklist. */
export function checklist(s, cats, products) {
  const decl = (k) => cats.every((c) => String(c.declarations?.[k] || '').trim());
  return [
    ['Legal name and address on every page', !!(s.legalName && (s.registeredAddress || s.businessAddress)), 'Business and invoices / Legal and customer care'],
    ['Customer care email and phone', !!(s.careEmail && s.carePhone), 'Legal and customer care'],
    ['Grievance officer name, email and phone', !!(s.grievanceName && s.grievanceEmail && s.grievancePhone), 'Legal and customer care'],
    ['GSTIN (if registered)', !s.gstRegistered || !!s.gstin, 'Business and invoices'],
    ['Return, refund, shipping and cancellation policies', true, 'Generated from your settings: see the site’s footer'],
    ['Manufacturer or packer name and address on listings', decl('maker'), 'Products → Collection details'],
    ['Month and year of manufacture on listings', decl('made_on'), 'Products → Collection details'],
    ['Country of origin and net quantity on listings', decl('country_of_origin') && decl('net_quantity'), 'Products → Collection details'],
    ['MRP set for every colour (else MRP = price)', products.every((p) => p.mrp == null || p.mrp >= p.price), 'Products'],
    ['Policies reviewed by a lawyer (date recorded)', !!s.policiesUpdatedAt, 'Legal and customer care'],
    ['Dark patterns self-audit within the last year', !!(s.darkPatternsAudit?.date && Date.now() - Date.parse(s.darkPatternsAudit.date) < 366 * 86400000), 'Below'],
  ];
}

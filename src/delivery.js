/**
 * Rough delivery estimates by PIN code until a courier (Shiprocket, Phase 5) gives real ones.
 * Edit ZONES once you know where orders ship from. Days are working days.
 */
const ZONES = [
  { name: 'metro', days: [3, 5], test: (pin) => /^(11|40|41|50|56|60|70|38)/.test(pin) },
  { name: 'remote', days: [7, 10], test: (pin) => /^(18|19|744|78|79|737)/.test(pin) },
  { name: 'rest', days: [5, 8], test: () => true },
];

export const validPin = (pin) => /^[1-9][0-9]{5}$/.test(pin);

/** Returns { from: Date, to: Date, label } or null for an invalid PIN. */
export function estimate(pin, now = new Date()) {
  if (!validPin(pin)) return null;
  const zone = ZONES.find((z) => z.test(pin));
  const add = (d, n) => {
    const x = new Date(d);
    while (n > 0) {
      x.setDate(x.getDate() + 1);
      if (x.getDay() !== 0) n--; // Sundays don't count
    }
    return x;
  };
  const from = add(now, zone.days[0]);
  const to = add(now, zone.days[1]);
  const f = (d) => d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
  return { from, to, label: `${f(from)} – ${f(to)}` };
}

export const INDIAN_STATES = [
  'Andaman and Nicobar Islands', 'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chandigarh', 'Chhattisgarh',
  'Dadra and Nagar Haveli and Daman and Diu', 'Delhi', 'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jammu and Kashmir',
  'Jharkhand', 'Karnataka', 'Kerala', 'Ladakh', 'Lakshadweep', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya',
  'Mizoram', 'Nagaland', 'Odisha', 'Puducherry', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura',
  'Uttar Pradesh', 'Uttarakhand', 'West Bengal',
];

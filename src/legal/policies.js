// Policy texts, written from the store's real settings. A starting point drafted against Indian law as of
// November 2026 (Consumer Protection Act 2019 and E-Commerce Rules 2020 as amended in 2026, DPDP Act 2023 and
// DPDP Rules 2025, Legal Metrology rules, CGST Act). Not legal advice: have a lawyer review before launch.
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const inr = (n) => '₹' + Number(n || 0).toLocaleString('en-IN');
const mail = (e) => `<a href="mailto:${esc(e)}">${esc(e)}</a>`;
const tel = (p) => (p ? `<a href="tel:${esc(p)}">${esc(p.replace(/^\+91(\d{5})(\d{5})$/, '+91 $1 $2'))}</a>` : '');

export const POLICY_PAGES = {
  privacy: 'Privacy policy',
  terms: 'Terms of use and sale',
  shipping: 'Shipping and delivery',
  returns: 'Returns and refunds',
  cancellation: 'Cancellation',
};

const grievance = (i) =>
  `${esc(i.grievance_name ? `${i.grievance_name}, ${i.grievance_title}` : i.grievance_title)}<br>${mail(i.grievance_email)}${i.grievance_phone ? `<br>${tel(i.grievance_phone)}` : ''}<br>${esc(i.address)}`;

const shippingFeeLine = (i) =>
  !i.shipping_fee
    ? 'Delivery is free on every order.'
    : i.free_shipping_over
      ? `Delivery costs ${inr(i.shipping_fee)}, and is free on orders of ${inr(i.free_shipping_over)} or more (after any discount).`
      : `Delivery costs ${inr(i.shipping_fee)} per order.`;

export function policy(key, i) {
  const S = (h, body) => ({ h, body });
  switch (key) {
    case 'privacy':
      return [
        S('Who we are', `<p>This store is run by <strong>${esc(i.name)}</strong>, ${esc(i.address)} (“we”). We decide why and how your personal data is used, so under India’s Digital Personal Data Protection Act, 2023 we are the <em>data fiduciary</em>. Questions about your data go to our ${esc(i.grievance_title)}:</p><p>${grievance(i)}</p>`),
        S('What we collect, and why', `<table class="ptable"><thead><tr><th>Data</th><th>Why we use it</th></tr></thead><tbody>
          <tr><td>Your email address, and if you give them, your name and mobile number</td><td>To create and secure your account and sign you in with a one-time code</td></tr>
          <tr><td>Name, mobile number, email and delivery address on an order</td><td>To deliver your order, send updates about it, and contact you about delivery</td></tr>
          <tr><td>What you ordered, prices paid, discount codes used</td><td>To fulfil the order, issue a tax invoice and keep the records tax law requires</td></tr>
          <tr><td>Payment reference and status (never your card, UPI or bank details, which go straight to Razorpay)</td><td>To confirm and, if needed, refund your payment</td></tr>
          <tr><td>Messages you send us, and return requests</td><td>To answer you and resolve complaints</td></tr>
          <tr><td>Saved addresses, wishlist and bag (signed-in shoppers)</td><td>To save you time; you can delete them at any time</td></tr>
          <tr><td>Your email, if you join our newsletter or ask for a back-in-stock alert</td><td>To send what you asked for, only with your consent</td></tr>
          <tr><td>Information your browser stores for this site (your bag, wishlist, sign-in session, privacy choices)</td><td>To make the site work. We use no advertising cookies; analytics only if you allow them under <a href="#" data-privacy-choices>Privacy choices</a></td></tr>
        </tbody></table><p>We don’t make decisions about you by automated means, and we don’t buy data about you from others.</p>`),
        S('Who we share it with', `<p>Only with the services that help us run the store, each bound to use it only for us:</p><ul>
          <li><strong>Razorpay</strong> (payments): processes your payment securely.</li>
          <li><strong>Shiprocket and its courier partners</strong> (delivery): your name, phone and address, to deliver and track your parcel.</li>
          <li><strong>Supabase</strong> (database and hosting) and <strong>Resend</strong> (email delivery): store our records and send our emails. Some of their systems may be outside India.</li>
          <li>Government authorities, only when the law requires it.</li></ul><p>We never sell your data.</p>`),
        S('How long we keep it', `<ul><li>Account details: until you delete your account.</li>
          <li>Orders and invoices: as long as tax and accounting laws require us to keep them (under GST law, currently about eight years), even after an account is deleted, but no longer linked to it.</li>
          <li>Support messages: up to three years after they are resolved.</li>
          <li>Newsletter: until you unsubscribe.</li></ul>`),
        S('Your rights', `<p>You can ask us for a summary of the personal data we hold and how we use it; correct, complete or update it; erase it (subject to what the law makes us keep); withdraw consent at any time, as easily as you gave it; nominate someone to exercise your rights if you can’t; and have your grievances resolved.</p>
          <p>The quickest way: sign in, open <a href="../account/#profile">Profile</a> and use <em>Request my data</em> or <em>Delete my account</em>. Every marketing email has an unsubscribe link. Or write to our ${esc(i.grievance_title)} (above), or use the <a href="../contact/">contact form</a>.</p>
          <p>If you aren’t satisfied with our answer, you can complain to the Data Protection Board of India.</p>`),
        S('Children', '<p>Our store is for adults. If you are under 18, please ask a parent or guardian to order for you. If you believe a child has given us personal data, contact us and we’ll delete it.</p>'),
        S('Keeping it safe', '<p>Data travels encrypted. Access is limited to the people who need it, and our staff sign in with two-step verification. Payment details never reach our systems. If a breach ever affects your data, we will tell you and the Data Protection Board as the law requires.</p>'),
        S('Changes', '<p>If we change this policy, we’ll update it here and change the date below. If a change is significant, we’ll email account holders.</p>'),
      ];
    case 'terms':
      return [
        S('About these terms', `<p>These terms apply when you use this website and buy from us. The seller is <strong>${esc(i.name)}</strong>, ${esc(i.address)}${i.gstin ? `, GSTIN ${esc(i.gstin)}` : ''}. By placing an order you agree to them, together with our <a href="?p=shipping">shipping</a>, <a href="?p=returns">returns</a>, <a href="?p=cancellation">cancellation</a> and <a href="?p=privacy">privacy</a> policies. Nothing here limits your rights under the Consumer Protection Act, 2019.</p>`),
        S('Using the site', '<p>You need to be 18 or over to buy, or to buy with a parent or guardian’s involvement. Please give accurate details and keep your sign-in email secure. Don’t misuse the site, interfere with it, or copy its content, photographs or designs, which belong to us.</p>'),
        S('Products and prices', `<p>We show each bag as accurately as we can; colours can look slightly different on different screens. Prices are in Indian rupees and include GST. Each listing shows the MRP (inclusive of all taxes), the country of origin and the other details the Legal Metrology rules require. Delivery charges and any cash-on-delivery fee are shown at checkout before you pay. ${esc(shippingFeeLine(i))}</p>`),
        S('Your order', `<p>Your order is confirmed when we email you: for online payments once the payment succeeds, for cash on delivery once you place it. Online payments are processed by Razorpay; we never see your card or UPI details. If an item turns out to be unavailable, or a price was shown wrongly because of an obvious error, we will contact you and you can choose a replacement or a full refund; we never charge more than the price you agreed to.</p>`),
        S('Delivery, returns and cancellation', '<p>See our <a href="?p=shipping">shipping</a>, <a href="?p=returns">returns and refunds</a> and <a href="?p=cancellation">cancellation</a> policies. A bag becomes yours on delivery.</p>'),
        S('If something is wrong with your bag', `<p>If a bag arrives damaged, is the wrong item or has a manufacturing defect, tell us within ${i.return_window_days || 7} days of delivery and we’ll collect it and replace or refund it at no cost to you.</p>`),
        S('Liability', '<p>We are responsible for losses that are a foreseeable result of our breaking these terms or failing to use reasonable care. We are not responsible for losses that were not foreseeable, or for business losses. This does not exclude any liability that cannot be excluded by law.</p>'),
        S('Complaints and disputes', `<p>Contact our ${esc(i.grievance_title)} (${mail(i.grievance_email)}) or use the <a href="../contact/">contact form</a>. We acknowledge every complaint within 48 hours and resolve it within one month. You can also contact the National Consumer Helpline (1915, consumerhelpline.gov.in). These terms are governed by the laws of India; courts at ${esc(i.city)} have jurisdiction, without affecting your right to approach a consumer commission.</p>`),
        S('Changes', '<p>We may update these terms. The version on the site when you place an order applies to that order.</p>'),
      ];
    case 'shipping':
      return [
        S('Where we deliver', '<p>Across India, wherever our courier partners serve. Enter your PIN code on any product page or at checkout to see whether we deliver there and how long it should take.</p>'),
        S('When it ships', `<p>We pack and dispatch orders within ${i.dispatch_days} working day${i.dispatch_days === 1 ? '' : 's'} (Monday to Saturday, excluding public holidays). You’ll get an email with tracking as soon as it leaves us, and another on the day it’s out for delivery.</p>`),
        S('Delivery charges', `<p>${esc(shippingFeeLine(i))} Any charge is shown at checkout before you pay.</p>`),
        S('Cash on delivery', i.cod_enabled ? `<p>Available for orders up to ${inr(i.cod_max)}, in PIN codes where our couriers collect cash${i.cod_fee ? `, with a cash-handling fee of ${inr(i.cod_fee)} shown at checkout` : ''}. Please keep the exact amount ready.</p>` : '<p>Cash on delivery is not available at the moment. You can pay online by UPI, card, net banking or wallet.</p>'),
        S('Delivery times', '<p>Most orders arrive within 3 to 7 working days of dispatch; remote areas can take longer. The estimate at checkout comes from our couriers and is not a guarantee, but if your order is late we’ll chase it for you.</p>'),
        S('If delivery doesn’t work out', '<p>Couriers usually try more than once. If a parcel comes back to us undelivered, we’ll contact you to send it again or refund you (for online payments, in full to your original payment method).</p>'),
        S('Damaged or tampered parcels', '<p>If the parcel looks damaged or opened, you may refuse it, or accept it and tell us within 48 hours with a photo. We’ll make it right at no cost to you.</p>'),
        S('Changing your address', '<p>Before dispatch, <a href="../contact/">contact us</a> with your order number and we’ll update it. After dispatch, we may not be able to.</p>'),
      ];
    case 'returns':
      return i.return_window_days
        ? [
            S('Our promise', `<p>If you’re not happy with your bag, you can return it within <strong>${i.return_window_days} days of delivery</strong>.</p>`),
            S('What can be returned', '<p>Bags that are unused, with their tags, in the condition they arrived (in the original packaging if you still have it). Damaged, wrong or defective items can always be returned within the window.</p>'),
            S('How to return', '<p>Open your order (from the confirmation email, or <em>Account → Orders</em>) and choose <em>Request a return</em>. Pick the items, tell us why, and we’ll reply within two working days. Once approved, a courier collects the parcel from your address.</p>'),
            S('Return pickup cost', `<p>${i.return_shipping_fee ? `Pickup costs ${inr(i.return_shipping_fee)}, deducted from your refund. It’s free when the item arrived damaged, was wrong or is defective.` : 'Return pickup is free.'}</p>`),
            S('Refunds', '<p>We check the bag within two working days of it reaching us and then refund the price you paid for it (less its share of any discount, and the pickup cost if one applies). Online payments are refunded to the original payment method; banks usually take 5 to 7 working days to show it. Cash-on-delivery orders are refunded by bank transfer to an account you give us. We email you at each step.</p>'),
            S('Exchanges', '<p>We don’t exchange directly. Return the bag and order the one you’d like instead; we’ll refund you as soon as the return is checked.</p>'),
          ]
        : [S('Returns', `<p>We are not accepting returns of unwanted items at the moment. If a bag arrives damaged, is the wrong item or has a manufacturing defect, <a href="../contact/">contact us</a> within 7 days of delivery and we’ll collect it and replace or refund it at no cost to you.</p>`)];
    case 'cancellation':
      return [
        S('Before we dispatch', `<p>You can cancel at no charge until your order ships. <a href="../contact/">Contact us</a> with your order number and choose “Cancel an order”. Online payments are refunded in full to your original payment method (banks usually take 5 to 7 working days); cash-on-delivery orders simply won’t be sent.</p>`),
        S('After dispatch', `<p>For cash on delivery you can decline the parcel at the door. For online payments, accept the parcel and return it under our <a href="?p=returns">returns policy</a>.</p>`),
        S('Unpaid online orders', `<p>If an online payment isn’t completed, the order is cancelled automatically after ${i.hold_minutes || 15} minutes and nothing is charged.</p>`),
        S('When we cancel', '<p>Rarely, we may have to cancel an order, for example if an item is unavailable or a price was shown in obvious error. We’ll tell you straight away and refund any payment in full.</p>'),
        S('Charges', '<p>We don’t charge for cancellations.</p>'),
      ];
    default:
      return null;
  }
}

import '../styles.css';
import '../pages.css';
import { LIVE, supabase } from '../lib/supabase.js';
import { esc, $ } from './ui.js';

// Printable invoice. Buyers open it with their order link (?id=&t=); staff open it from the order panel (?id=&staff=1).
document.body.classList.add('invoice-page');
const main = $('#main');
const q = new URLSearchParams(location.search);
const id = q.get('id');

const n2 = (v) => Number(v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** 2598.5 -> "Two thousand five hundred ninety-eight rupees and fifty paise only" (Indian numbering). */
export function inWords(amount) {
  const ones = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
  const tens = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
  const two = (n) => (n < 20 ? ones[n] : tens[Math.floor(n / 10)] + (n % 10 ? '-' + ones[n % 10] : ''));
  const three = (n) => (n >= 100 ? `${ones[Math.floor(n / 100)]} hundred${n % 100 ? ' ' + two(n % 100) : ''}` : two(n));
  const words = (n) => {
    if (n === 0) return 'zero';
    const parts = [];
    const crore = Math.floor(n / 1e7);
    const lakh = Math.floor((n % 1e7) / 1e5);
    const thousand = Math.floor((n % 1e5) / 1e3);
    const rest = n % 1e3;
    if (crore) parts.push(`${words(crore)} crore`);
    if (lakh) parts.push(`${two(lakh)} lakh`);
    if (thousand) parts.push(`${two(thousand)} thousand`);
    if (rest) parts.push(three(rest));
    return parts.join(' ');
  };
  const rupees = Math.floor(amount);
  const paise = Math.round((amount - rupees) * 100);
  const s = `${words(rupees)} rupees${paise ? ` and ${two(paise)} paise` : ''} only`;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

async function load() {
  if (!LIVE || !id) return null;
  if (q.get('staff')) {
    const { data } = await supabase.from('invoices').select('data').eq('order_id', id).maybeSingle();
    return data?.data || null;
  }
  const { data } = await supabase.rpc('invoice_lookup', { p_id: id, p_token: q.get('t') });
  return data;
}

function render(d) {
  const reg = d.registered;
  const intra = d.intra_state;
  const date = (t) => new Date(t).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  document.title = `${d.number} | VERTU`;
  main.innerHTML = `
  <article class="inv">
    <header class="inv__head">
      <div><span class="side__logo inv__logo" role="img" aria-label="VERTU"></span>
        <p class="inv__seller"><strong>${esc(d.seller.name)}</strong><br>${esc(d.seller.address)}<br>${esc(d.seller.state)}${d.seller.gstin ? `<br>GSTIN ${esc(d.seller.gstin)}` : ''}</p></div>
      <div class="inv__meta"><h1>${esc(d.title)}</h1>
        <dl><div><dt>Invoice no.</dt><dd>${esc(d.number)}</dd></div><div><dt>Invoice date</dt><dd>${date(d.date)}</dd></div>
        <div><dt>Order</dt><dd>${esc(d.order_id)}, ${date(d.order_date)}</dd></div>${reg ? `<div><dt>Place of supply</dt><dd>${esc(d.place_of_supply)}</dd></div>` : ''}</dl></div>
    </header>
    <section class="inv__to"><p class="inv__label">Bill to / ship to</p>
      <p><strong>${esc(d.buyer.name)}</strong><br>${esc(d.buyer.address)}<br>${esc(d.buyer.city)}, ${esc(d.buyer.state)} ${esc(d.buyer.pin)}<br>${esc(d.buyer.phone)} · ${esc(d.buyer.email)}</p></section>
    <table class="inv__table">
      <thead><tr><th>Item</th><th>HSN</th><th class="r">Qty</th><th class="r">Amount</th>${d.lines.some((l) => Number(l.discount)) ? '<th class="r">Discount</th>' : ''}${reg ? `<th class="r">Taxable value</th><th class="r">Rate</th>${intra ? '<th class="r">CGST</th><th class="r">SGST</th>' : '<th class="r">IGST</th>'}` : ''}<th class="r">Total</th></tr></thead>
      <tbody>${d.lines
        .map(
          (l) => `<tr><td>${esc(l.description)}${l.sku ? `<br><span class="muted">${esc(l.sku)}</span>` : ''}</td><td>${esc(l.hsn)}</td><td class="r">${l.qty}</td><td class="r">${n2(l.gross)}</td>
          ${d.lines.some((x) => Number(x.discount)) ? `<td class="r">${Number(l.discount) ? '−' + n2(l.discount) : ''}</td>` : ''}
          ${reg ? `<td class="r">${n2(l.taxable)}</td><td class="r">${Number(l.rate)}%</td>${intra ? `<td class="r">${n2(l.cgst)}</td><td class="r">${n2(l.sgst)}</td>` : `<td class="r">${n2(l.igst)}</td>`}` : ''}
          <td class="r">${n2(l.total)}</td></tr>`,
        )
        .join('')}</tbody>
    </table>
    <div class="inv__totals"><dl>
      ${reg ? `<div><dt>Taxable value</dt><dd>₹${n2(d.totals.taxable)}</dd></div>${intra ? `<div><dt>CGST</dt><dd>₹${n2(d.totals.cgst)}</dd></div><div><dt>SGST</dt><dd>₹${n2(d.totals.sgst)}</dd></div>` : `<div><dt>IGST</dt><dd>₹${n2(d.totals.igst)}</dd></div>`}` : ''}
      <div class="inv__grand"><dt>Total</dt><dd>₹${n2(d.totals.total)}</dd></div></dl>
      <p class="inv__words">${inWords(Number(d.totals.total))}</p></div>
    <footer class="inv__foot"><p>${reg ? 'Prices include GST. Tax is not payable on reverse charge.' : 'The seller is not registered under GST; no GST is charged on this invoice.'}
      Paid by ${d.payment_method === 'cod' ? 'cash on delivery' : d.payment_method === 'razorpay' ? 'online payment' : 'arrangement'}.</p>
      <p>This is a computer-generated invoice and needs no signature.</p></footer>
    <p class="inv__actions"><button class="btn btn--ink" type="button" onclick="print()">Print or save as PDF</button></p>
  </article>`;
}

(async () => {
  let d = null;
  try {
    d = await load();
  } catch (_) {
    /* shown below */
  }
  if (!d) {
    main.innerHTML = `<div class="empty-state"><h1 class="page-title">No invoice yet.</h1><p>${LIVE ? 'An invoice is issued when your order ships. If it has shipped, check the link from your order page.' : 'Invoices are issued once the store is connected to its database.'}</p></div>`;
    return;
  }
  render(d);
})();

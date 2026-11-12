// Email templates. Plain JS (no dependencies) so Deno and the Node tests share it.
// Every email has an HTML version (table layout, inline styles: what email apps understand) and a text version.
// render(kind, payload, cfg) -> { subject, html, text, headers }

const C = { paper: '#f5f3ee', paper2: '#ebe8e1', stone: '#d6d2c9', ink: '#22201d', ink2: '#5c5852', accent: '#4a7048' };
const SERIF = "Georgia, 'Times New Roman', serif";
const SANS = "-apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const inr = (n) => '₹' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });
const first = (name) => String(name || '').trim().split(/\s+/)[0] || '';
const q = encodeURIComponent;

const orderUrl = (cfg, p) => `${cfg.siteUrl}/order/?id=${q(p.order_id)}&t=${q(p.token)}`;
const productUrl = (cfg, p) => `${cfg.siteUrl}/product/?c=${q(p.category)}&colour=${q(String(p.colour || '').toLowerCase())}`;
const adminOrderUrl = (cfg, p) => `${cfg.siteUrl}/admin/#/orders?open=${q(p.order_id)}`;
const unsubUrl = (cfg, token) => `${cfg.siteUrl}/newsletter/?unsubscribe=${q(token)}`;

// ---------------------------------------------------------------- building blocks
const h1 = (t) => `<h1 style="margin:0 0 16px;font-family:${SERIF};font-style:italic;font-weight:400;font-size:34px;line-height:1.15;color:${C.ink}">${t}</h1>`;
const p = (t, extra = '') => `<p style="margin:0 0 16px;font-family:${SANS};font-size:16px;line-height:1.6;color:${C.ink2};${extra}">${t}</p>`;
const small = (t) => `<p style="margin:0 0 10px;font-family:${SANS};font-size:13px;line-height:1.6;color:${C.ink2}">${t}</p>`;
const button = (href, label) => `
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 24px"><tr>
    <td style="background:${C.accent}"><a href="${esc(href)}" style="display:inline-block;padding:15px 28px;font-family:${SANS};font-size:15px;font-weight:600;color:#ffffff;text-decoration:none">${esc(label)}</a></td>
  </tr></table>`;
const rule = `<tr><td style="padding:8px 0"><div style="height:1px;line-height:1px;background:${C.stone}">&nbsp;</div></td></tr>`;
const label = (t) => `<p style="margin:0 0 8px;font-family:${SANS};font-size:13px;font-weight:600;color:${C.ink}">${t}</p>`;

function linesTable(lines) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-top:1px solid ${C.ink}">${(lines || [])
    .map(
      (l) => `<tr>
        <td style="padding:12px 0;border-bottom:1px solid ${C.stone};font-family:${SANS};font-size:15px;color:${C.ink}">${esc(l.colour)} ${esc(l.name)}<span style="color:${C.ink2}"> &times; ${Number(l.qty)}</span></td>
        <td align="right" style="padding:12px 0;border-bottom:1px solid ${C.stone};font-family:${SANS};font-size:15px;color:${C.ink};white-space:nowrap">${inr(l.price * l.qty)}</td></tr>`,
    )
    .join('')}</table>`;
}

function totalsTable(o, { cod = false } = {}) {
  const row = (k, v, strong = false) => `<tr>
    <td style="padding:5px 0;font-family:${SANS};font-size:${strong ? 16 : 14}px;color:${strong ? C.ink : C.ink2};${strong ? 'font-weight:600;' : ''}">${k}</td>
    <td align="right" style="padding:5px 0;font-family:${strong ? SERIF : SANS};font-size:${strong ? 22 : 14}px;color:${C.ink}">${v}</td></tr>`;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:10px 0 24px">
    ${row('Subtotal', inr(o.subtotal ?? o.total))}
    ${o.discount ? row(`Discount${o.coupon ? ` (${esc(o.coupon)})` : ''}`, '−' + inr(o.discount)) : ''}
    ${row('Shipping', o.shipping ? inr(o.shipping) : 'Free')}
    ${o.cod_fee ? row('Cash on delivery fee', inr(o.cod_fee)) : ''}
    ${row(cod ? 'To pay on delivery' : 'Total', inr(o.total), true)}
  </table>`;
}

const address = (o) =>
  `${esc(o.name)}<br>${esc(o.address?.line)}<br>${esc(o.address?.city)}, ${esc(o.address?.state)} ${esc(o.address?.pin)}`;

function layout(cfg, { preheader, body, footerNote = '', unsubscribe = null }) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>VERTU</title></head>
<body style="margin:0;padding:0;background:${C.paper}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(preheader)}&#8199;&#65279;&#847;&#8199;&#65279;&#847;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.paper}"><tr><td align="center" style="padding:32px 16px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px">
    <tr><td style="padding:0 0 28px"><a href="${esc(cfg.siteUrl)}/" style="text-decoration:none">
      <img src="${esc(cfg.siteUrl)}/email/logo.png" width="112" height="26" alt="VERTU" style="display:block;border:0;width:112px;height:auto;font-family:${SERIF};font-size:24px;letter-spacing:2px;color:${C.accent}"></a></td></tr>
    <tr><td style="background:#fbfaf7;padding:36px 32px 28px;border-top:2px solid ${C.ink}">${body}</td></tr>
    <tr><td style="padding:24px 4px 0">
      ${footerNote ? small(footerNote) : ''}
      ${small(`Questions? Reply to this email or write to <a href="mailto:${esc(cfg.supportEmail)}" style="color:${C.ink}">${esc(cfg.supportEmail)}</a>.`)}
      ${unsubscribe ? small(`You’re getting this because you asked for VERTU news. <a href="${esc(unsubUrl(cfg, unsubscribe))}" style="color:${C.ink}">Unsubscribe</a>.`) : ''}
      ${small('VERTU · A utility-first bag brand designed for modern everyday life.')}
    </td></tr>
  </table>
</td></tr></table></body></html>`;
}

const textLines = (lines) => (lines || []).map((l) => `- ${l.colour} ${l.name} x ${l.qty}: ${inr(l.price * l.qty)}`).join('\n');
const textTotals = (o, cod) =>
  [`Subtotal: ${inr(o.subtotal ?? o.total)}`, o.discount ? `Discount: -${inr(o.discount)}` : '', `Shipping: ${o.shipping ? inr(o.shipping) : 'Free'}`, o.cod_fee ? `Cash on delivery fee: ${inr(o.cod_fee)}` : '', `${cod ? 'To pay on delivery' : 'Total'}: ${inr(o.total)}`]
    .filter(Boolean)
    .join('\n');
const textFooter = (cfg, unsubscribe) =>
  `\n\nQuestions? Reply to this email or write to ${cfg.supportEmail}.${unsubscribe ? `\nUnsubscribe: ${unsubUrl(cfg, unsubscribe)}` : ''}\nVERTU`;

// ---------------------------------------------------------------- the emails

const T = {
  order_confirmed(o, cfg) {
    const cod = o.payment_method === 'cod';
    const lead = cod
      ? `Your order is confirmed. Please keep <strong style="color:${C.ink}">${inr(o.total)}</strong> ready for the courier.`
      : `Your payment of <strong style="color:${C.ink}">${inr(o.total)}</strong> is confirmed. We’ll write again when your order is on its way.`;
    return {
      subject: `Order ${o.order_id} confirmed`,
      preheader: cod ? `Pay ${inr(o.total)} on delivery.` : `Payment of ${inr(o.total)} received.`,
      body: `${h1(`Thank you${first(o.name) ? `, ${esc(first(o.name))}` : ''}.`)}${p(lead)}
        ${label(`Order ${esc(o.order_id)}`)}${linesTable(o.lines)}${totalsTable(o, { cod })}
        ${label('Delivering to')}${p(address(o))}${button(orderUrl(cfg, o), 'View your order')}`,
      text: `Thank you${first(o.name) ? `, ${first(o.name)}` : ''}.\n\n${cod ? `Your order is confirmed. Please keep ${inr(o.total)} ready for the courier.` : `Your payment of ${inr(o.total)} is confirmed.`}\n\nOrder ${o.order_id}\n${textLines(o.lines)}\n\n${textTotals(o, cod)}\n\nView your order: ${orderUrl(cfg, o)}`,
    };
  },
  order_shipped(o, cfg) {
    const via = o.courier ? ` with ${esc(o.courier)}` : '';
    const track = o.tracking_number ? ` Tracking number: <strong style="color:${C.ink}">${esc(o.tracking_number)}</strong>.` : '';
    return {
      subject: `Your VERTU order is on its way`,
      preheader: `Order ${o.order_id} has shipped${o.courier ? ` with ${o.courier}` : ''}.`,
      body: `${h1('It’s on its way.')}${p(`Order ${esc(o.order_id)} has left us${via}.${track}`)}
        ${button(o.tracking_url || orderUrl(cfg, o), o.tracking_url ? 'Track your parcel' : 'View your order')}
        ${label('Delivering to')}${p(address(o))}${o.payment_method === 'cod' && o.payment_status === 'cod' ? p(`Please keep <strong style="color:${C.ink}">${inr(o.total)}</strong> ready for the courier.`) : ''}`,
      text: `It's on its way.\n\nOrder ${o.order_id} has left us${o.courier ? ` with ${o.courier}` : ''}.${o.tracking_number ? ` Tracking number: ${o.tracking_number}.` : ''}\n\n${o.tracking_url ? `Track it: ${o.tracking_url}` : `View your order: ${orderUrl(cfg, o)}`}`,
    };
  },
  order_out_for_delivery(o, cfg) {
    const cod = o.payment_method === 'cod' && o.payment_status === 'cod';
    return {
      subject: `Arriving today: order ${o.order_id}`,
      preheader: cod ? `Please keep ${inr(o.total)} ready.` : 'Your order is out for delivery.',
      body: `${h1('Arriving today.')}${p(`Order ${esc(o.order_id)} is out for delivery${o.courier ? ` with ${esc(o.courier)}` : ''}. The courier may call ${esc(o.phone || 'your number')} when they’re close.`)}
        ${cod ? p(`Please keep <strong style="color:${C.ink}">${inr(o.total)}</strong> ready for the courier.`) : ''}
        ${button(o.tracking_url || orderUrl(cfg, o), o.tracking_url ? 'Track your parcel' : 'View your order')}`,
      text: `Arriving today.\n\nOrder ${o.order_id} is out for delivery.${cod ? ` Please keep ${inr(o.total)} ready.` : ''}\n\n${o.tracking_url || orderUrl(cfg, o)}`,
    };
  },
  return_requested(o, cfg) {
    return {
      subject: `We’ve got your return request for ${o.order_id}`,
      preheader: 'We’ll reply within two working days.',
      body: `${h1('Return request received.')}${p(`Thanks for letting us know. We’ll look at your request for order ${esc(o.order_id)} and reply within two working days.`)}
        ${label('Returning')}${linesTable(o.return_items)}<div style="height:20px"></div>${button(orderUrl(cfg, o), 'View your order')}`,
      text: `Return request received for order ${o.order_id}. We'll reply within two working days.\n\n${textLines(o.return_items)}\n\n${orderUrl(cfg, o)}`,
    };
  },
  return_approved(o, cfg) {
    return {
      subject: `Your return for ${o.order_id} is approved`,
      preheader: 'A courier will collect it.',
      body: `${h1('Return approved.')}${o.admin_note ? p(esc(o.admin_note)) : ''}${p('A courier will contact you to collect the parcel. Please pack the bag with its tags, in the original packaging if you still have it.')}
        ${p('Once it reaches us and we’ve checked it, we’ll refund you to your original payment method (cash orders: to a bank account we’ll ask you for).')}
        ${label('Returning')}${linesTable(o.return_items)}<div style="height:20px"></div>${button(orderUrl(cfg, o), 'View your order')}`,
      text: `Return approved for order ${o.order_id}.${o.admin_note ? `\n\n${o.admin_note}` : ''}\n\nA courier will contact you to collect the parcel. We'll refund you once it reaches us.\n\n${orderUrl(cfg, o)}`,
    };
  },
  return_rejected(o, cfg) {
    return {
      subject: `About your return request for ${o.order_id}`,
      preheader: 'We couldn’t accept this return.',
      body: `${h1('We couldn’t accept this return.')}${p(o.admin_note ? esc(o.admin_note) : 'This return doesn’t meet our returns policy.')}${p('If you think we’ve got this wrong, reply to this email and a person will take another look.')}`,
      text: `We couldn't accept your return for order ${o.order_id}.\n\n${o.admin_note || ''}\n\nReply to this email if you think we've got it wrong.`,
    };
  },
  admin_return(o, cfg) {
    const why = { damaged: 'Damaged', wrong_item: 'Wrong item', not_as_described: 'Not as described', changed_mind: 'Changed their mind', other: 'Other' }[o.reason] || o.reason;
    return {
      subject: `Return requested: ${o.order_id} (${why})`,
      preheader: `${o.name}: ${why}`,
      body: `${h1('A return was requested.')}${p(`${esc(o.name)}, order ${esc(o.order_id)}. Reason: <strong style="color:${C.ink}">${esc(why)}</strong>.`)}${o.details ? p(`“${esc(o.details)}”`) : ''}
        ${linesTable(o.return_items)}<div style="height:20px"></div>${button(`${cfg.siteUrl}/admin/#/returns`, 'Review the return')}`,
      text: `Return requested: ${o.order_id} (${why})\n${o.details || ''}\n\n${textLines(o.return_items)}\n\n${cfg.siteUrl}/admin/#/returns`,
    };
  },
  order_delivered(o, cfg) {
    return {
      subject: `Delivered: order ${o.order_id}`,
      preheader: 'We hope it’s everything you wanted.',
      body: `${h1('Delivered.')}${p(`Order ${esc(o.order_id)} has arrived. We hope it’s everything you wanted, and that it makes the day a little easier to carry.`)}
        ${p('If anything isn’t right, just reply to this email and a person will help.')}${button(orderUrl(cfg, o), 'View your order')}`,
      text: `Delivered.\n\nOrder ${o.order_id} has arrived. If anything isn't right, just reply to this email.\n\nView your order: ${orderUrl(cfg, o)}`,
    };
  },
  order_cancelled(o, cfg) {
    const refunded = Number(o.refunded_amount || 0);
    const money = refunded
      ? `${inr(refunded)} is on its way back to your original payment method. Banks usually take 5–7 working days to show it.`
      : o.payment_method === 'cod'
        ? 'Nothing was charged, so there’s nothing to pay.'
        : 'If you were charged, the refund will follow in a separate email.';
    return {
      subject: `Order ${o.order_id} has been cancelled`,
      preheader: refunded ? `${inr(refunded)} refunded.` : 'Nothing to pay.',
      body: `${h1('Your order was cancelled.')}${p(`Order ${esc(o.order_id)} has been cancelled. ${money}`)}${linesTable(o.lines)}
        <div style="height:20px"></div>${p('If this wasn’t what you expected, reply to this email and we’ll sort it out.')}`,
      text: `Your order was cancelled.\n\nOrder ${o.order_id} has been cancelled. ${money}\n\n${textLines(o.lines)}`,
    };
  },
  order_refunded(o, cfg) {
    return {
      subject: `Refund of ${inr(o.refund)} for order ${o.order_id}`,
      preheader: 'Usually shows in 5–7 working days.',
      body: `${h1('Your refund is on its way.')}${p(`We’ve refunded <strong style="color:${C.ink}">${inr(o.refund)}</strong> for order ${esc(o.order_id)} to your original payment method. Banks usually take 5–7 working days to show it.`)}
        ${button(orderUrl(cfg, o), 'View your order')}`,
      text: `Your refund is on its way.\n\nWe've refunded ${inr(o.refund)} for order ${o.order_id}. Banks usually take 5-7 working days to show it.\n\n${orderUrl(cfg, o)}`,
    };
  },
  back_in_stock(x, cfg) {
    const few = x.stock > 0 && x.stock <= 5;
    return {
      subject: `${x.colour} ${x.name} is back`,
      preheader: few ? `Only ${x.stock} available.` : 'Back in stock now.',
      body: `${h1(`${esc(x.colour)} is back.`)}${p(`You asked us to tell you when the ${esc(x.colour)} ${esc(x.name)} returned. It’s in stock now at ${inr(x.price)}${few ? `, but there are only ${Number(x.stock)}` : ''}.`)}
        ${button(productUrl(cfg, x), `Shop ${x.colour}`)}${small('This is the one email you asked for. We won’t write again about it.')}`,
      text: `${x.colour} is back.\n\nThe ${x.colour} ${x.name} is in stock now at ${inr(x.price)}${few ? ` (only ${x.stock})` : ''}.\n\n${productUrl(cfg, x)}`,
    };
  },
  abandoned_cart(x, cfg) {
    const lines = x.items || [];
    return {
      subject: 'Still thinking it over?',
      preheader: 'Your bag is saved.',
      unsubscribe: x.unsubscribe,
      body: `${h1(`Still thinking it over${first(x.name) ? `, ${esc(first(x.name))}` : ''}?`)}${p('Your bag is saved. Here’s what’s in it, in case you’d like another look.')}
        ${linesTable(lines)}<div style="height:20px"></div>${button(`${cfg.siteUrl}/checkout/`, 'Return to your bag')}`,
      text: `Still thinking it over?\n\nYour bag is saved:\n${textLines(lines)}\n\nReturn to your bag: ${cfg.siteUrl}/checkout/`,
    };
  },
  newsletter_confirm(x, cfg) {
    const url = `${cfg.siteUrl}/newsletter/?confirm=${q(x.token)}`;
    return {
      subject: 'Confirm your VERTU subscription',
      preheader: 'One click to confirm.',
      body: `${h1('One more step.')}${p('Confirm your email and we’ll write when there are new colours and launches. A few times a year, never shared.')}
        ${button(url, 'Confirm subscription')}${small('Didn’t ask for this? Ignore this email and you won’t hear from us.')}`,
      text: `One more step.\n\nConfirm your subscription: ${url}\n\nDidn't ask for this? Ignore this email.`,
    };
  },
  admin_new_order(o, cfg) {
    const pay = o.payment_method === 'cod' ? 'Cash on delivery' : 'Paid online';
    return {
      subject: `New order ${o.order_id} · ${inr(o.total)}`,
      preheader: `${o.name}, ${o.address?.city}. ${pay}.`,
      body: `${h1(`New order ${esc(o.order_id)}`)}${p(`${esc(o.name)} in ${esc(o.address?.city)}. ${pay}.`)}${linesTable(o.lines)}${totalsTable(o, { cod: o.payment_method === 'cod' })}
        ${label('Ship to')}${p(`${address(o)}<br>${esc(o.phone || '')}`)}${button(adminOrderUrl(cfg, o), 'Open in the store manager')}`,
      text: `New order ${o.order_id}: ${inr(o.total)} (${pay})\n${o.name}, ${o.address?.city}\n\n${textLines(o.lines)}\n\n${adminOrderUrl(cfg, o)}`,
    };
  },
  admin_attention(o, cfg) {
    return {
      subject: `Order ${o.order_id} needs a look`,
      preheader: String(o.flag || ''),
      body: `${h1('An order needs a look.')}${p(`Order ${esc(o.order_id)} (${inr(o.total)}, ${esc(o.name)}): <strong style="color:${C.ink}">${esc(String(o.flag || '').replace(/_/g, ' '))}</strong>.`)}
        ${p(/^returning_to_us/.test(o.flag || '') ? 'The courier is bringing this parcel back to us (delivery didn’t succeed). Contact the customer to re-ship or refund.'
          : /^delivery_problem/.test(o.flag || '') ? 'The courier reported a delivery problem. Check the tracking and contact the customer.'
          : /^amount_mismatch/.test(o.flag || '') ? 'The amount paid didn’t match the order total. Check the payment in Razorpay before shipping.'
          : 'A payment arrived after the order’s hold had expired and the stock had sold out. Refund it or contact the customer.')}${button(adminOrderUrl(cfg, o), 'Open the order')}`,
      text: `Order ${o.order_id} needs a look: ${o.flag}\n\n${adminOrderUrl(cfg, o)}`,
    };
  },
  admin_low_stock(x, cfg) {
    return {
      subject: `Low stock: ${x.colour} ${x.name} (${x.stock} left)`,
      preheader: `At or below your alert level of ${x.threshold}.`,
      body: `${h1('Running low.')}${p(`${esc(x.colour)} ${esc(x.name)} (${esc(x.sku)}) is down to <strong style="color:${C.ink}">${Number(x.stock)}</strong>, at or below your alert level of ${Number(x.threshold)}.`)}
        ${button(`${cfg.siteUrl}/admin/#/products?stock=low`, 'Review stock')}`,
      text: `${x.colour} ${x.name} (${x.sku}) is down to ${x.stock}.\n\n${cfg.siteUrl}/admin/#/products?stock=low`,
    };
  },
};

export const KINDS = Object.keys(T);

export function render(kind, payload, cfg) {
  const t = T[kind];
  if (!t) throw new Error(`unknown email kind: ${kind}`);
  const c = { siteUrl: String(cfg.siteUrl || '').replace(/\/$/, ''), supportEmail: cfg.supportEmail || 'contact.shopvertu@gmail.com', functionsUrl: cfg.functionsUrl || '' };
  const r = t(payload || {}, c);
  const headers = {};
  if (r.unsubscribe) {
    headers['List-Unsubscribe'] = `<${c.functionsUrl ? `${c.functionsUrl}/email-unsubscribe?t=${q(r.unsubscribe)}` : unsubUrl(c, r.unsubscribe)}>`;
    if (c.functionsUrl) headers['List-Unsubscribe-Post'] = 'List-Unsubscribe=One-Click';
  }
  return {
    subject: r.subject,
    html: layout(c, { preheader: r.preheader, body: r.body, unsubscribe: r.unsubscribe }),
    text: r.text + textFooter(c, r.unsubscribe),
    headers,
  };
}

// ---------------------------------------------------------------- sending

export function resendSender(apiKey, fetchImpl = fetch) {
  if (!apiKey) return null;
  return async ({ from, to, subject, html, text, headers, replyTo, idempotencyKey }) => {
    const res = await fetchImpl('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}) },
      body: JSON.stringify({ from, to: [to], subject, html, text, headers, ...(replyTo ? { reply_to: replyTo } : {}) }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json?.message || `Resend responded ${res.status}`);
    return json.id;
  };
}

const safeEqual = (a, b) => {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let x = 0;
  for (let i = 0; i < a.length; i++) x |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return x === 0;
};

/**
 * One run of the sender (called every minute by pg_cron).
 * deps: { rpc, send, from, replyTo, siteUrl, supportEmail, functionsUrl, cronSecret, batches }
 */
export async function handleSendEmails(secret, deps) {
  if (!deps.cronSecret || !safeEqual(String(secret || ''), deps.cronSecret)) return { status: 401, body: { error: 'unauthorised' } };
  if (!deps.send || !deps.from || !deps.siteUrl) return { status: 503, body: { error: 'email_not_configured' } };
  let sent = 0;
  let failed = 0;
  for (let b = 0; b < (deps.batches || 3); b++) {
    const rows = await deps.rpc('claim_outbox', { p_limit: 25 });
    if (!rows?.length) break;
    for (const r of rows) {
      try {
        const e = render(r.kind, r.payload, deps);
        const id = await deps.send({ from: deps.from, to: r.to, subject: e.subject, html: e.html, text: e.text, headers: e.headers, replyTo: deps.replyTo, idempotencyKey: `vertu-email-${r.id}` });
        await deps.rpc('complete_outbox', { p_id: r.id, p_ok: true, p_provider_id: id || null, p_error: null });
        sent++;
      } catch (err) {
        await deps.rpc('complete_outbox', { p_id: r.id, p_ok: false, p_provider_id: null, p_error: String(err?.message || err) });
        failed++;
      }
    }
  }
  return { status: 200, body: { sent, failed } };
}

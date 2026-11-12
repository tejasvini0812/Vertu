// Sends whatever is waiting in the email outbox (called every minute by pg_cron, see supabase/schedule_emails.sql).
// Needs: RESEND_API_KEY, EMAIL_FROM ("VERTU <orders@yourdomain.com>"), SITE_URL, EMAIL_CRON_SECRET; optional EMAIL_REPLY_TO, SUPPORT_EMAIL.
import { serve, json, rpc } from '../_shared/http.ts';
// @ts-ignore shared JS
import { handleSendEmails, resendSender } from '../_shared/emails.js';

const send = resendSender(Deno.env.get('RESEND_API_KEY'));

serve(async (req) => {
  const r = await handleSendEmails(req.headers.get('x-cron-secret'), {
    rpc,
    send,
    from: Deno.env.get('EMAIL_FROM') || '',
    replyTo: Deno.env.get('EMAIL_REPLY_TO') || Deno.env.get('SUPPORT_EMAIL') || '',
    siteUrl: Deno.env.get('SITE_URL') || '',
    supportEmail: Deno.env.get('SUPPORT_EMAIL') || 'contact.shopvertu@gmail.com',
    functionsUrl: `${Deno.env.get('SUPABASE_URL')}/functions/v1`,
    cronSecret: Deno.env.get('EMAIL_CRON_SECRET') || '',
  });
  return json(req, r.status, r.body);
}, { name: 'send-emails' });

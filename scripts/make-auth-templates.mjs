// Writes branded Supabase Auth email templates (supabase/templates/*.html) in the same style as the store's emails.
// They use Supabase's template variables: {{ .Token }}, {{ .ConfirmationURL }}, {{ .SiteURL }}.
import { writeFileSync } from 'node:fs';

const C = { paper: '#f5f3ee', stone: '#d6d2c9', ink: '#22201d', ink2: '#5c5852', accent: '#4a7048' };
const SERIF = "Georgia, 'Times New Roman', serif";
const SANS = "-apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const page = (title, body) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head>
<body style="margin:0;padding:0;background:${C.paper}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.paper}"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px">
<tr><td style="padding:0 0 28px"><img src="{{ .SiteURL }}/email/logo.png" width="112" alt="VERTU" style="display:block;border:0;width:112px;height:auto;font-family:${SERIF};font-size:24px;color:${C.accent}"></td></tr>
<tr><td style="background:#fbfaf7;padding:36px 32px 28px;border-top:2px solid ${C.ink}">${body}</td></tr>
<tr><td style="padding:22px 4px 0;font-family:${SANS};font-size:13px;line-height:1.6;color:${C.ink2}">Didn’t ask for this? You can ignore this email; nothing changes without you.<br>VERTU · A utility-first bag brand designed for modern everyday life.</td></tr>
</table></td></tr></table></body></html>
`;
const h1 = (t) => `<h1 style="margin:0 0 16px;font-family:${SERIF};font-style:italic;font-weight:400;font-size:32px;line-height:1.15;color:${C.ink}">${t}</h1>`;
const p = (t) => `<p style="margin:0 0 16px;font-family:${SANS};font-size:16px;line-height:1.6;color:${C.ink2}">${t}</p>`;
const code = `<p style="margin:8px 0 24px;font-family:${SERIF};font-size:40px;letter-spacing:10px;color:${C.ink}">{{ .Token }}</p>`;
const button = (label) => `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 20px"><tr><td style="background:${C.accent}"><a href="{{ .ConfirmationURL }}" style="display:inline-block;padding:15px 28px;font-family:${SANS};font-size:15px;font-weight:600;color:#ffffff;text-decoration:none">${label}</a></td></tr></table>`;

const T = {
  magic_link: ['Your VERTU sign-in code', page('Sign in', `${h1('Your sign-in code')}${p('Enter this code on the VERTU sign-in page. It works once and expires within the hour.')}${code}${p('Or sign in with one tap:')}${button('Sign in to VERTU')}`)],
  confirmation: ['Confirm your VERTU account', page('Confirm', `${h1('Welcome to VERTU.')}${p('Enter this code to finish creating your account, or use the button.')}${code}${button('Confirm my email')}`)],
  recovery: ['Reset your VERTU password', page('Reset password', `${h1('Choose a new password')}${p('Someone (hopefully you) asked to reset the password for this account. The link works once and expires within the hour.')}${button('Choose a new password')}`)],
  invite: ['You’re invited to the VERTU store manager', page('Invite', `${h1('You’re invited.')}${p('You’ve been invited to help run the VERTU store. Accept the invitation to set your password; you’ll set up two-step verification when you first sign in.')}${button('Accept invitation')}`)],
};
for (const [name, [, html]] of Object.entries(T)) writeFileSync(new URL(`../supabase/templates/${name}.html`, import.meta.url), html);
writeFileSync(new URL('../supabase/templates/subjects.json', import.meta.url), JSON.stringify(Object.fromEntries(Object.entries(T).map(([k, [s]]) => [k, s])), null, 2) + '\n');
console.log('templates:', Object.keys(T).join(', '));

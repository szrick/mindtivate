// Cloudflare Worker entry point (see wrangler.jsonc's "main"). Wrangler
// bundles this with esbuild, not tsc — it's deliberately excluded from
// Astro's own TypeScript project (see tsconfig.json) since it runs in the
// Workers runtime, not the browser/DOM environment the rest of the
// codebase is typed against.
//
// Routing is intentionally minimal: two API routes for newsletter signup
// (double opt-in — see below), everything else falls through to the
// ASSETS binding (the static site Astro builds into ./dist). This is the
// only server-side logic Mindtivate has — the site is otherwise fully
// static.
//
// Double opt-in, without a database: a contact is created in Resend
// immediately on signup but with unsubscribed:true (so it's excluded
// from broadcasts), and a confirmation email is sent with a link
// containing a signed token — not a random ID looked up in storage, but
// the email + expiry itself, HMAC-signed with CONFIRM_SECRET so it can't
// be forged. Clicking the link (GET /api/confirm) verifies the signature
// and flips the same contact's unsubscribed to false. No KV/D1 needed.

export interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
  RESEND_API_KEY: string;
  // Not secret (an ID, not a credential) — set as a plain var in
  // wrangler.jsonc. Required for contacts to actually be reachable by a
  // broadcast: Resend's Broadcasts API sends to a specific audience_id,
  // so a contact created without one would never receive
  // scripts/pipeline/7-newsletter-broadcast.mjs's emails.
  RESEND_AUDIENCE_ID?: string;
  // "Display Name <address@verified-domain>" — also not secret, but set
  // as a Worker var (Cloudflare dashboard or wrangler.jsonc) rather than
  // hardcoded, since it depends on which domain is verified in Resend.
  RESEND_FROM_EMAIL: string;
  // Secret — must be a Worker Secret (Cloudflare dashboard → Variables
  // and Secrets → Secret), never a plain var. Anyone with this value can
  // forge a confirmation token for any email address.
  CONFIRM_SECRET: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TOKEN_TTL_MS = 1000 * 60 * 60 * 48; // 48 hours

// --- base64url + HMAC helpers (Web Crypto, available in the Workers runtime) ---

function base64UrlEncodeBytes(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlEncodeString(str: string): string {
  return base64UrlEncodeBytes(new TextEncoder().encode(str));
}

function base64UrlDecodeToString(str: string): string {
  const padLength = (4 - (str.length % 4)) % 4;
  const padded = str.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat(padLength);
  return atob(padded);
}

async function hmacSign(data: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sigBuffer = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  return base64UrlEncodeBytes(new Uint8Array(sigBuffer));
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

async function createConfirmToken(email: string, secret: string): Promise<string> {
  const payload = base64UrlEncodeString(JSON.stringify({ email, exp: Date.now() + TOKEN_TTL_MS }));
  const signature = await hmacSign(payload, secret);
  return `${payload}.${signature}`;
}

async function verifyConfirmToken(token: string, secret: string): Promise<string | null> {
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return null;
  const expectedSignature = await hmacSign(payload, secret);
  if (!timingSafeEqual(signature, expectedSignature)) return null;
  let data: { email?: string; exp?: number };
  try {
    data = JSON.parse(base64UrlDecodeToString(payload));
  } catch {
    return null;
  }
  if (!data.email || !data.exp || Date.now() > data.exp) return null;
  return data.email;
}

// --- Resend API calls ---

async function resendCreateContact(email: string, env: Env): Promise<Response> {
  return fetch('https://api.resend.com/contacts', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email,
      unsubscribed: true, // pending confirmation — flipped to false in resendConfirmContact
      ...(env.RESEND_AUDIENCE_ID ? { audience_id: env.RESEND_AUDIENCE_ID } : {}),
    }),
  });
}

async function resendConfirmContact(email: string, env: Env): Promise<Response> {
  return fetch(`https://api.resend.com/contacts/${encodeURIComponent(email)}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ unsubscribed: false }),
  });
}

async function resendSendConfirmationEmail(email: string, confirmUrl: string, env: Env): Promise<Response> {
  const html = `<!doctype html>
<html><body style="margin:0;padding:32px 24px;background:#fbf6ef;font-family:Georgia,serif;">
  <div style="max-width:480px;margin:0 auto;">
    <p style="margin:0 0 1.5em;font-size:13px;letter-spacing:0.04em;text-transform:uppercase;color:#5f7457;font-family:Arial,sans-serif;">Mindtivate Insights</p>
    <h1 style="margin:0 0 0.6em;font-size:22px;line-height:1.3;color:#2f2a33;">Confirm your subscription</h1>
    <p style="margin:0 0 1.3em;font-size:16px;line-height:1.6;color:#2f2a33;">One click and you're set — this just confirms it's really you.</p>
    <p style="margin:0;">
      <a href="${confirmUrl}" style="display:inline-block;padding:0.85em 1.6em;border-radius:999px;background:#d97a5f;color:#ffffff;text-decoration:none;font-family:Arial,sans-serif;font-weight:bold;font-size:15px;">Confirm subscription</a>
    </p>
    <p style="margin:1.5em 0 0;font-size:13px;color:#55505c;font-family:Arial,sans-serif;">If you didn't sign up for this, you can ignore this email.</p>
  </div>
</body></html>`;
  const text = `Confirm your Mindtivate Insights subscription: ${confirmUrl}\n\nIf you didn't sign up for this, you can ignore this email.`;

  return fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: env.RESEND_FROM_EMAIL,
      to: email,
      subject: 'Confirm your Mindtivate Insights subscription',
      html,
      text,
    }),
  });
}

// --- HTTP plumbing ---

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

// No-JS fallback: a plain <form method="post"> submission redirects to a
// static page instead of showing raw JSON.
function redirectResponse(request: Request, path: string): Response {
  return Response.redirect(new URL(path, request.url).toString(), 303);
}

async function readSubmission(
  request: Request,
): Promise<{ email: string; honeypot: string; isJson: boolean }> {
  const contentType = request.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    const body = (await request.json()) as Record<string, unknown>;
    return {
      email: String(body.email ?? '').trim(),
      honeypot: String(body.company ?? '').trim(),
      isJson: true,
    };
  }
  const form = await request.formData();
  return {
    email: String(form.get('email') ?? '').trim(),
    honeypot: String(form.get('company') ?? '').trim(),
    isJson: false,
  };
}

async function handleSubscribe(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  let email: string;
  let honeypot: string;
  let isJson: boolean;
  try {
    ({ email, honeypot, isJson } = await readSubmission(request));
  } catch {
    return jsonResponse({ error: 'Invalid request body' }, 400);
  }

  const fail = (message: string, status: number) =>
    isJson ? jsonResponse({ error: message }, status) : redirectResponse(request, '/newsletter/error');
  const succeed = () =>
    isJson ? jsonResponse({ ok: true, pending: true }) : redirectResponse(request, '/newsletter/thanks');

  // Honeypot: real visitors never fill this hidden field in. Pretend
  // success and drop it silently rather than telling a bot what tripped it.
  if (honeypot) {
    return succeed();
  }

  if (!email || !EMAIL_RE.test(email)) {
    return fail('Please enter a valid email address.', 400);
  }

  if (!env.RESEND_API_KEY || !env.CONFIRM_SECRET || !env.RESEND_FROM_EMAIL) {
    return fail('Newsletter signup is not configured yet.', 500);
  }

  const createRes = await resendCreateContact(email, env);
  // 409 = contact already exists. Either they're already confirmed (fine,
  // no email needed) or still pending (re-sending the confirmation email
  // below is harmless and helps if the first one got lost).
  if (!createRes.ok && createRes.status !== 409) {
    console.error('Resend contact creation failed', createRes.status, await createRes.text());
    return fail('Something went wrong — please try again.', 502);
  }

  const confirmUrl = new URL(`/api/confirm?token=${await createConfirmToken(email, env.CONFIRM_SECRET)}`, request.url).toString();
  const emailRes = await resendSendConfirmationEmail(email, confirmUrl, env);
  if (!emailRes.ok) {
    // The contact was created; only the confirmation email failed. Still
    // tell the visitor something went wrong, since without that email
    // they have no way to actually confirm.
    console.error('Resend confirmation email failed', emailRes.status, await emailRes.text());
    return fail('Something went wrong sending the confirmation email — please try again.', 502);
  }

  return succeed();
}

async function handleConfirm(request: Request, env: Env): Promise<Response> {
  const token = new URL(request.url).searchParams.get('token');
  if (!token || !env.CONFIRM_SECRET) {
    return redirectResponse(request, '/newsletter/confirm-error');
  }

  const email = await verifyConfirmToken(token, env.CONFIRM_SECRET);
  if (!email) {
    return redirectResponse(request, '/newsletter/confirm-error');
  }

  const res = await resendConfirmContact(email, env);
  if (!res.ok) {
    console.error('Resend contact confirm failed', res.status, await res.text());
    return redirectResponse(request, '/newsletter/confirm-error');
  }

  return redirectResponse(request, '/newsletter/confirmed');
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/api/subscribe') {
      return handleSubscribe(request, env);
    }
    if (url.pathname === '/api/confirm') {
      return handleConfirm(request, env);
    }
    return env.ASSETS.fetch(request);
  },
};

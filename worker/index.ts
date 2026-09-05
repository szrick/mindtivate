// Cloudflare Worker entry point (see wrangler.jsonc's "main"). Wrangler
// bundles this with esbuild, not tsc — it's deliberately excluded from
// Astro's own TypeScript project (see tsconfig.json) since it runs in the
// Workers runtime, not the browser/DOM environment the rest of the
// codebase is typed against.
//
// Routing is intentionally minimal: two API routes for newsletter signup
// (double opt-in — see below), a /go/<slug> affiliate-link redirect, and
// everything else falls through to the ASSETS binding (the static site
// Astro builds into ./dist). This is the only server-side logic
// Mindtivate has — the site is otherwise fully static.
//
// Double opt-in, without a database: a contact is created in Resend
// immediately on signup but with unsubscribed:true (so it's excluded
// from broadcasts), and a confirmation email is sent with a link
// containing a signed token — not a random ID looked up in storage, but
// the email + expiry itself, HMAC-signed with CONFIRM_SECRET so it can't
// be forged. Clicking the link (GET /api/confirm) verifies the signature
// and flips the same contact's unsubscribed to false. No KV/D1 needed.

import goLinks from './go-links.generated.json';

// Minimal local shape for what the Workers runtime actually passes in —
// avoids a dependency on @cloudflare/workers-types just for this one
// method. Used to defer the welcome sequence's sends past the response
// handleConfirm already returned (see sendWelcomeSequence).
interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
}

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
const CONFIRM_TOKEN_TTL_MS = 1000 * 60 * 60 * 48; // 48 hours
// Unsubscribe links go out in every welcome-sequence email and need to
// keep working no matter how long someone leaves an email sitting in
// their inbox before acting on it — years, realistically — unlike a
// confirmation link, which is fine to expire quickly.
const UNSUBSCRIBE_TOKEN_TTL_MS = 1000 * 60 * 60 * 24 * 365 * 5; // 5 years

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

// Shared by both link types below — a token is just a signed, self-expiring
// {email, exp} pair, so creating one only needs a TTL, and verifying one
// doesn't need to know (or care) which kind it originally was.
async function createSignedToken(email: string, secret: string, ttlMs: number): Promise<string> {
  const payload = base64UrlEncodeString(JSON.stringify({ email, exp: Date.now() + ttlMs }));
  const signature = await hmacSign(payload, secret);
  return `${payload}.${signature}`;
}

function createConfirmToken(email: string, secret: string): Promise<string> {
  return createSignedToken(email, secret, CONFIRM_TOKEN_TTL_MS);
}

function createUnsubscribeToken(email: string, secret: string): Promise<string> {
  return createSignedToken(email, secret, UNSUBSCRIBE_TOKEN_TTL_MS);
}

async function verifySignedToken(token: string, secret: string): Promise<string | null> {
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

async function resendGetContact(email: string, env: Env): Promise<Response> {
  return fetch(`https://api.resend.com/contacts/${encodeURIComponent(email)}`, {
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}` },
  });
}

async function resendUnsubscribeContact(email: string, env: Env): Promise<Response> {
  return fetch(`https://api.resend.com/contacts/${encodeURIComponent(email)}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ unsubscribed: true }),
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

// --- Welcome sequence (Day 0 / 3 / 7), sent once a contact confirms ---

// Shared visual shell for every welcome-sequence email — same palette as
// resendSendConfirmationEmail's HTML above, plus a CTA button and an
// unsubscribe footer (the confirmation email skips the footer since
// nobody's opted in yet at that point).
function renderWelcomeEmailHtml(opts: {
  heading: string;
  bodyHtml: string;
  ctaText: string;
  ctaUrl: string;
  unsubscribeUrl: string;
}): string {
  return `<!doctype html>
<html><body style="margin:0;padding:32px 24px;background:#fbf6ef;font-family:Georgia,serif;">
  <div style="max-width:480px;margin:0 auto;">
    <p style="margin:0 0 1.5em;font-size:13px;letter-spacing:0.04em;text-transform:uppercase;color:#5f7457;font-family:Arial,sans-serif;">Mindtivate Insights</p>
    <h1 style="margin:0 0 0.6em;font-size:22px;line-height:1.3;color:#2f2a33;">${opts.heading}</h1>
    ${opts.bodyHtml}
    <p style="margin:1.5em 0 0;">
      <a href="${opts.ctaUrl}" style="display:inline-block;padding:0.85em 1.6em;border-radius:999px;background:#d97a5f;color:#ffffff;text-decoration:none;font-family:Arial,sans-serif;font-weight:bold;font-size:15px;">${opts.ctaText}</a>
    </p>
    <p style="margin:2em 0 0;font-size:12px;color:#8a8390;font-family:Arial,sans-serif;">You're getting this because you confirmed your subscription to Mindtivate Insights. <a href="${opts.unsubscribeUrl}" style="color:#8a8390;">Unsubscribe</a></p>
  </div>
</body></html>`;
}

interface WelcomeSequenceStep {
  delayDays: number; // 0 = send right away, alongside the /newsletter/confirmed redirect
  subject: string;
  heading: string;
  bodyHtml: string;
  bodyText: string;
  ctaText: string;
  ctaPath: string;
}

const WELCOME_SEQUENCE: WelcomeSequenceStep[] = [
  {
    delayDays: 0,
    subject: "You're in — welcome to Mindtivate Insights",
    heading: "Welcome — glad you're here",
    bodyHtml: `<p style="margin:0 0 1.3em;font-size:16px;line-height:1.6;color:#2f2a33;">You'll hear from us with practical, evidence-checked guidance on body, food, mind, and hormones — sourced from what women are actually asking, not what's trending. No overwhelm, no guilt, nothing to sell you.</p>`,
    bodyText:
      "You'll hear from us with practical, evidence-checked guidance on body, food, mind, and hormones — sourced from what women are actually asking, not what's trending. No overwhelm, no guilt, nothing to sell you.",
    ctaText: 'Browse the site',
    ctaPath: '/articles',
  },
  {
    delayDays: 3,
    subject: 'Where should you start?',
    heading: 'Eight places to start',
    bodyHtml: `<p style="margin:0 0 1.3em;font-size:16px;line-height:1.6;color:#2f2a33;">Everything on Mindtivate falls under one of eight topics — Body, Food, Mind, Hormones, Love, Beauty, Sleep, and Life Stages. If you're not sure where to look first, that's the fastest way in.</p>`,
    bodyText:
      "Everything on Mindtivate falls under one of eight topics — Body, Food, Mind, Hormones, Love, Beauty, Sleep, and Life Stages. If you're not sure where to look first, that's the fastest way in.",
    ctaText: 'Explore topics',
    ctaPath: '/#newsletter',
  },
  {
    delayDays: 7,
    subject: 'The one thing we want you to remember',
    heading: "It's not about doing more",
    bodyHtml: `<p style="margin:0 0 1.3em;font-size:16px;line-height:1.6;color:#2f2a33;">Every article we publish gets checked against the actual evidence before it goes up — not rewritten trend pieces. If something here is ever wrong or worth pushing back on, just reply to this email and tell us.</p>`,
    bodyText:
      "Every article we publish gets checked against the actual evidence before it goes up — not rewritten trend pieces. If something here is ever wrong or worth pushing back on, just reply to this email and tell us.",
    ctaText: 'Read the latest',
    ctaPath: '/articles',
  },
];

// Runs from ctx.waitUntil after handleConfirm has already redirected the
// visitor — nobody is waiting on these requests, so a slow or failed send
// here (logged, not thrown) never delays or breaks the confirm flow.
async function sendWelcomeSequence(email: string, request: Request, env: Env): Promise<void> {
  const unsubscribeUrl = new URL(
    `/api/unsubscribe?token=${await createUnsubscribeToken(email, env.CONFIRM_SECRET)}`,
    request.url,
  ).toString();

  await Promise.all(
    WELCOME_SEQUENCE.map(async (step) => {
      const ctaUrl = new URL(step.ctaPath, request.url).toString();
      const html = renderWelcomeEmailHtml({
        heading: step.heading,
        bodyHtml: step.bodyHtml,
        ctaText: step.ctaText,
        ctaUrl,
        unsubscribeUrl,
      });
      const text = `${step.bodyText}\n\n${step.ctaText}: ${ctaUrl}\n\nUnsubscribe: ${unsubscribeUrl}`;

      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: env.RESEND_FROM_EMAIL,
          to: email,
          subject: step.subject,
          html,
          text,
          // Omit scheduled_at for the immediate (Day 0) email — Resend
          // rejects a scheduled_at that isn't meaningfully in the future.
          ...(step.delayDays > 0
            ? { scheduled_at: new Date(Date.now() + step.delayDays * 24 * 60 * 60 * 1000).toISOString() }
            : {}),
        }),
      });
      if (!res.ok) {
        console.error(`Welcome sequence send failed (day ${step.delayDays})`, res.status, await res.text());
      }
    }),
  );
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

// Affiliate-link cloaking: every product's rendered "Check current price"
// link (see ProductCallout.astro) points here instead of straight at the
// affiliate URL, so a rotated/expired link only ever needs updating on
// the product record -- see scripts/lib/generate-go-links.mjs, which
// (re)generates go-links.generated.json from src/content/products/*.md
// before every build. A 302 (not 301) on purpose: affiliate links do
// change over time, and a temporary redirect avoids the destination
// getting permanently cached by a browser or crawler.
function handleGoLink(pathname: string, request: Request): Response {
  const slug = decodeURIComponent(pathname.replace(/^\/go\//, '').replace(/\/$/, ''));
  const destination = (goLinks as Record<string, string>)[slug];
  if (!destination) {
    return redirectResponse(request, '/');
  }
  return Response.redirect(destination, 302);
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

async function handleConfirm(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const token = new URL(request.url).searchParams.get('token');
  if (!token || !env.CONFIRM_SECRET) {
    return redirectResponse(request, '/newsletter/confirm-error');
  }

  const email = await verifySignedToken(token, env.CONFIRM_SECRET);
  if (!email) {
    return redirectResponse(request, '/newsletter/confirm-error');
  }

  // Checked before confirming, not after: some corporate email scanners
  // auto-follow links in incoming mail before a human ever opens it, and a
  // real subscriber can also just click an old confirmation email a
  // second time. Either way, only a contact that's actually transitioning
  // from pending to confirmed here should kick off the welcome sequence —
  // otherwise a repeat hit on this route would re-send it from scratch.
  const existing = await resendGetContact(email, env);
  const alreadyConfirmed =
    existing.ok && ((await existing.json()) as { unsubscribed?: boolean }).unsubscribed === false;

  const res = await resendConfirmContact(email, env);
  if (!res.ok) {
    console.error('Resend contact confirm failed', res.status, await res.text());
    return redirectResponse(request, '/newsletter/confirm-error');
  }

  if (!alreadyConfirmed) {
    ctx.waitUntil(sendWelcomeSequence(email, request, env));
  }

  return redirectResponse(request, '/newsletter/confirmed');
}

async function handleUnsubscribe(request: Request, env: Env): Promise<Response> {
  const token = new URL(request.url).searchParams.get('token');
  if (!token || !env.CONFIRM_SECRET) {
    return redirectResponse(request, '/newsletter/unsubscribe-error');
  }

  const email = await verifySignedToken(token, env.CONFIRM_SECRET);
  if (!email) {
    return redirectResponse(request, '/newsletter/unsubscribe-error');
  }

  const res = await resendUnsubscribeContact(email, env);
  if (!res.ok) {
    console.error('Resend contact unsubscribe failed', res.status, await res.text());
    return redirectResponse(request, '/newsletter/unsubscribe-error');
  }

  return redirectResponse(request, '/newsletter/unsubscribed');
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/api/subscribe') {
      return handleSubscribe(request, env);
    }
    if (url.pathname === '/api/confirm') {
      return handleConfirm(request, env, ctx);
    }
    if (url.pathname === '/api/unsubscribe') {
      return handleUnsubscribe(request, env);
    }
    if (url.pathname.startsWith('/go/')) {
      return handleGoLink(url.pathname, request);
    }
    return env.ASSETS.fetch(request);
  },
};

// Cloudflare Worker entry point (see wrangler.jsonc's "main"). Wrangler
// bundles this with esbuild, not tsc — it's deliberately excluded from
// Astro's own TypeScript project (see tsconfig.json) since it runs in the
// Workers runtime, not the browser/DOM environment the rest of the
// codebase is typed against.
//
// Routing is intentionally minimal: one API route for the newsletter
// signup, everything else falls through to the ASSETS binding (the
// static site Astro builds into ./dist). This is the only server-side
// logic Mindtivate has — the site is otherwise fully static.

export interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
  RESEND_API_KEY: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// No-JS fallback: a plain <form method="post"> submission redirects to a
// static thank-you/error page instead of showing raw JSON.
function redirectResponse(request: Request, path: string): Response {
  return Response.redirect(new URL(path, request.url).toString(), 303);
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
    isJson ? jsonResponse({ ok: true }) : redirectResponse(request, '/newsletter/thanks');

  // Honeypot: real visitors never fill this hidden field in. Pretend
  // success and drop it silently rather than telling a bot what tripped it.
  if (honeypot) {
    return succeed();
  }

  if (!email || !EMAIL_RE.test(email)) {
    return fail('Please enter a valid email address.', 400);
  }

  if (!env.RESEND_API_KEY) {
    return fail('Newsletter signup is not configured yet.', 500);
  }

  const resendRes = await fetch('https://api.resend.com/contacts', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, unsubscribed: false }),
  });

  // 409 = already subscribed, which is fine from the visitor's perspective.
  if (!resendRes.ok && resendRes.status !== 409) {
    console.error('Resend contact creation failed', resendRes.status, await resendRes.text());
    return fail('Something went wrong — please try again.', 502);
  }

  return succeed();
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/api/subscribe') {
      return handleSubscribe(request, env);
    }
    return env.ASSETS.fetch(request);
  },
};

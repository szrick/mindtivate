// Minimal Resend API client (no SDK dependency) — used only by
// scripts/pipeline/7-newsletter-broadcast.mjs. This is a separate,
// locally-run counterpart to worker/index.ts's contact-creation call:
// the Worker adds subscribers to the audience in real time as people
// sign up, this script sends a broadcast to that same audience.

const API_URL = 'https://api.resend.com';

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

async function resendFetch(path, options) {
  const apiKey = requireEnv('RESEND_API_KEY');
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });
  if (!res.ok) {
    throw new Error(`Resend API error (${path}): ${res.status} ${await res.text()}`);
  }
  return res.json();
}

/**
 * Creates a broadcast and, if `send` is true, sends it immediately in the
 * same call (Resend's create-broadcast endpoint accepts a `send` flag —
 * no separate send-broadcast call needed for the immediate case).
 */
export async function createBroadcast({ audienceId, from, subject, html, text, name, send = false }) {
  return resendFetch('/broadcasts', {
    method: 'POST',
    body: JSON.stringify({
      audience_id: audienceId || requireEnv('RESEND_AUDIENCE_ID'),
      from,
      subject,
      html,
      text,
      name,
      send,
    }),
  });
}

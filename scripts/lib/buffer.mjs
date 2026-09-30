// Buffer API client (GraphQL, https://api.buffer.com) -- an alternative
// posting channel for Pinterest pins while this project's own Pinterest
// app is still on Trial access (see docs/SETUP.md's Pinterest section).
// Buffer is an official Pinterest Marketing Developer Partner, so pins
// published through it go out via Pinterest's *own* already-Standard API
// access rather than this app's Trial-limited one -- the Pinterest
// account still has to be connected as a channel inside Buffer's own
// dashboard first (one-time, done by hand; the API can't do that initial
// OAuth linking itself).
//
// NOTE ON EXACT SCHEMA: written from Buffer's own developer docs
// (developers.buffer.com) as summarized via search -- this session's
// network policy blocks that domain directly, so the exact mutation
// field names below are our best-informed guess, not something fetched
// and confirmed against the live schema. bufferGraphQL() surfaces the
// full GraphQL error array on any failure specifically so a real "Unknown
// argument"/"Field ... of required type ... was not provided" error (if
// one comes back) is immediately visible and actionable rather than
// swallowed -- expect one fix-forward round once this is first run for
// real in CI.

const API_URL = 'https://api.buffer.com';

function requireApiKey() {
  const apiKey = process.env.BUFFER_API_KEY;
  if (!apiKey) throw new Error('Missing required env var: BUFFER_API_KEY');
  return apiKey;
}

async function bufferGraphQL(query, variables = {}) {
  const apiKey = requireApiKey();
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!res.ok) {
    throw new Error(`Buffer API HTTP error: ${res.status} ${await res.text()}`);
  }

  const payload = await res.json();
  if (payload.errors?.length) {
    throw new Error(`Buffer GraphQL error: ${JSON.stringify(payload.errors, null, 2)}`);
  }

  return payload.data;
}

/**
 * Lists every channel (social account) connected to this Buffer account.
 * Read-only -- safe to call freely, no way to post anything by accident.
 */
export async function listChannels() {
  const data = await bufferGraphQL(`
    query {
      channels {
        id
        service
        serviceUsername
      }
    }
  `);
  return data.channels;
}

/** Finds the connected Pinterest channel, or null if none is linked yet. */
export async function findPinterestChannel() {
  const channels = await listChannels();
  return channels.find((c) => c.service?.toLowerCase() === 'pinterest') ?? null;
}

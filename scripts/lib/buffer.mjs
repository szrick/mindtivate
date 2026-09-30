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
// SCHEMA CONFIRMED LIVE: developers.buffer.com is blocked by this
// session's network policy, so every shape below was recovered via
// GraphQL introspection against the real API instead (see git history
// for scripts/pipeline/buffer-diagnostic.mjs, deleted once this was
// confirmed working, for the full round-by-round trace) -- not a guess
// from docs. createPin() has been exercised for real end to end: a live
// call (saveToDraft: true) against the connected Pinterest channel
// ("mindtivate") and its "Mindtivate Test Board" board returned
// PostActionSuccess -- a real draft landed in Buffer's queue, nothing
// published to Pinterest.

const API_URL = 'https://api.buffer.com';

function requireApiKey() {
  const apiKey = process.env.BUFFER_API_KEY;
  if (!apiKey) throw new Error('Missing required env var: BUFFER_API_KEY');
  return apiKey;
}

// Non-throwing: returns the full { data, errors } payload as-is. Used
// directly by diagnostics/introspection, where a partial result (e.g.
// __type resolving to null for an unknown name) is informative rather
// than fatal. bufferGraphQL (below) wraps this with the throw-on-error
// behavior real callers want.
export async function bufferGraphQLRaw(query, variables = {}) {
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

  return res.json();
}

async function bufferGraphQL(query, variables = {}) {
  const payload = await bufferGraphQLRaw(query, variables);
  if (payload.errors?.length) {
    throw new Error(`Buffer GraphQL error: ${JSON.stringify(payload.errors, null, 2)}`);
  }
  return payload.data;
}

/**
 * This account has exactly one Buffer organization (confirmed live via
 * account.organizations -- id 6abc9d21a3325fb2b8a972ed, "My organization").
 * channels(input: ChannelsInput!) requires organizationId, so every
 * channel-listing call needs it first; cached per-process since it won't
 * change within a single script run.
 */
let cachedOrganizationId;

async function getOrganizationId() {
  if (cachedOrganizationId) return cachedOrganizationId;
  const data = await bufferGraphQL(`
    query {
      account {
        organizations { id }
      }
    }
  `);
  const organizationId = data.account?.organizations?.[0]?.id;
  if (!organizationId) throw new Error('Buffer account has no organizations');
  cachedOrganizationId = organizationId;
  return organizationId;
}

/**
 * Lists every channel (social account) connected to this Buffer account.
 * Read-only -- safe to call freely, no way to post anything by accident.
 */
export async function listChannels() {
  const organizationId = await getOrganizationId();
  const data = await bufferGraphQL(
    `
    query ($input: ChannelsInput!) {
      channels(input: $input) {
        id
        service
        serviceId
        name
        displayName
      }
    }
  `,
    { input: { organizationId } },
  );
  return data.channels;
}

/** Finds the connected Pinterest channel, or null if none is linked yet. */
export async function findPinterestChannel() {
  const channels = await listChannels();
  return channels.find((c) => c.service?.toLowerCase() === 'pinterest') ?? null;
}

// Mirrors pinterest.mjs's createPin() parameter shape so callers (e.g. a
// future stage swapped between the two backends) don't need to know
// which one they're talking to. Defaults to saveToDraft: true -- i.e.
// it lands as a draft in Buffer's own queue for a human to review and
// approve there, rather than publishing to Pinterest immediately. This
// matches this project's existing draft -> human-approval -> send
// pattern for Pinterest pins (see scripts/pipeline/5-pinterest-pin.mjs)
// and means a caller has to explicitly opt in (saveToDraft: false) to
// make this actually publish live.
//
// needsApproval defaults to false, confirmed live: passing true 400'd
// with "needsApproval is only valid when your posting policy on this
// channel requires approval" -- that's a Buffer *team* review-workflow
// feature (multi-person approval queues), unrelated to and not needed
// for saveToDraft's own held-back-from-publishing behavior, and this
// channel has no such policy configured.
export async function createPin({
  title,
  description,
  link,
  imageUrl,
  boardServiceId,
  channelId,
  needsApproval = false,
  saveToDraft = true,
}) {
  const channel = channelId || (await findPinterestChannel())?.id;
  if (!channel) throw new Error('No connected Pinterest channel found in Buffer');
  if (!imageUrl) throw new Error('Missing imageUrl');

  const data = await bufferGraphQL(
    `
    mutation ($input: CreatePostInput!) {
      createPost(input: $input) {
        __typename
        ... on InvalidInputError { message }
      }
    }
  `,
    {
      input: {
        channelId: channel,
        assets: [{ image: { url: imageUrl } }],
        text: description,
        mode: 'shareNow',
        schedulingType: 'automatic',
        needsApproval,
        saveToDraft,
        metadata: {
          pinterest: { boardServiceId, title, url: link },
        },
      },
    },
  );
  return data.createPost;
}

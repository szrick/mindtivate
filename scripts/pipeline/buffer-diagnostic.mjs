#!/usr/bin/env node
// One-off diagnostic, not a pipeline stage: confirms BUFFER_API_KEY works
// and finds the connected Pinterest channel's id -- read-only, can't post
// anything. Meant to be deleted once scripts/lib/buffer.mjs's real
// posting mutation has been written and confirmed against the actual
// schema (see that file's header comment for why this two-step approach
// was needed: Buffer's docs domain is blocked by this session's network
// policy, so the exact GraphQL shape couldn't be fetched and confirmed
// ahead of time).
//
// Usage: node scripts/pipeline/buffer-diagnostic.mjs

import { loadEnv } from '../lib/env.mjs';
import { bufferGraphQLRaw } from '../lib/buffer.mjs';

loadEnv();

// Rounds 1-4 (see PR history) traced the real path to a working channel
// list: `channels(input: ChannelsInput!)` needs `organizationId:
// OrganizationId!`, and that comes from `account { organizations { id } }`
// -- confirmed by introspection (account takes no args, returns Account,
// which has a non-null `organizations` list). This round fetches the
// real organizationId via that path and, if found, immediately tries the
// actual channels() query with it -- the first attempt at real (non-
// introspection) data since round 1.
async function run() {
  console.log('Fetching account.organizations...');
  const accountData = await bufferGraphQLRaw(`
    query {
      account {
        id
        email
        organizations { id name }
      }
    }
  `);
  console.log('account:', JSON.stringify(accountData, null, 2));

  const organizationId = accountData.data?.account?.organizations?.[0]?.id;
  if (!organizationId) {
    console.log('No organizationId found -- stopping here.');
    return;
  }

  console.log(`\nListing channels for organizationId=${organizationId}...`);
  const channelsData = await bufferGraphQLRaw(
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
  console.log('channels:', JSON.stringify(channelsData, null, 2));
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

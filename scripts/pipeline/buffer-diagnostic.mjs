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

// Rounds 1-7 (see PR history) confirmed real, working reads (organizationId,
// the Pinterest channel's id) and traced createPost's top-level input
// shape: channelId (ChannelId!), assets ([AssetInput!]!), mode
// (ShareMode!), schedulingType (SchedulingType!), needsApproval
// (Boolean!), text (String), metadata (PostInputMetaData) -- metadata is
// the likely home for Pinterest-specific fields (a pin needs a board,
// unlike a plain social post). This round introspects the remaining
// unknowns: AssetInput's fields (how an image URL is attached),
// ShareMode/SchedulingType's enum values, and PostInputMetaData's fields.
async function run() {
  const typeNames = ['AssetInput', 'ShareMode', 'SchedulingType', 'PostInputMetaData'];
  for (const typeName of typeNames) {
    const result = await bufferGraphQLRaw(`
      query {
        __type(name: "${typeName}") {
          name
          kind
          inputFields {
            name
            type { name kind ofType { name kind ofType { name kind ofType { name kind } } } }
          }
          enumValues { name }
        }
      }
    `);
    console.log(`${typeName}:`, JSON.stringify(result, null, 2));
  }
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

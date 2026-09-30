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

// Rounds 1-5 (see PR history) confirmed real, working reads: the account's
// organizationId (6abc9d21a3325fb2b8a972ed) and the connected Pinterest
// channel's id (6abc9d67ea19ca0bde2eebce, service "pinterest", serviceId/
// name/displayName all "mindtivate"). The only remaining unknown for the
// actual posting integration is the Mutation side -- what the real
// create/publish-a-post mutation is called and shaped like. This
// introspects the root Mutation type's field names (cheap) to find it.
async function run() {
  console.log('Introspecting Buffer schema (root Mutation type field names)...');
  const schema = await bufferGraphQLRaw(`
    query {
      mutationType: __type(name: "Mutation") {
        fields { name }
      }
    }
  `);
  console.log(JSON.stringify(schema, null, 2));
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

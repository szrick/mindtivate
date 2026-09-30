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

// Round 1 (see PR history) hit two wrong field-name/argument guesses.
// Round 2 introspected Channel + ChannelsInput directly and got the real
// shape: `channels(input: ChannelsInput!)` needs `organizationId:
// OrganizationId!` (required) plus an optional `filter` -- so the next
// unknown is *where to get organizationId from*. Rather than guess a
// query name for that too, this introspects the root Query type's field
// names (cheap, one line each) to find the real entry point -- almost
// certainly something like `me`/`user`/`organizations`.
async function run() {
  console.log('Introspecting Buffer schema (root Query type field names)...');
  const schema = await bufferGraphQLRaw(`
    query {
      queryType: __type(name: "Query") {
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

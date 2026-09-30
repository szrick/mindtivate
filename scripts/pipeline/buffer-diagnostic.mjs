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

// First real run (see PR history) hit two schema-shape guesses that were
// wrong: `serviceUsername` isn't a Channel field, and `channels` requires
// a `ChannelsInput!` argument. Rather than guess a third time, this
// introspects both the Channel type and the ChannelsInput input type in
// one call, aliased so a single query gets both answers -- then, if that
// succeeds, immediately tries listing channels using whatever `input`
// shape the introspection reveals is required (best-effort: an empty
// object `{}` first, since a lot of Buffer-style paginated list inputs
// accept all-optional fields).
async function run() {
  console.log('Introspecting Buffer schema (Channel type + ChannelsInput input type)...');
  const schema = await bufferGraphQLRaw(`
    query {
      channelType: __type(name: "Channel") {
        fields { name type { name kind ofType { name kind ofType { name kind } } } }
      }
      channelsInputType: __type(name: "ChannelsInput") {
        inputFields { name type { name kind ofType { name kind ofType { name kind } } } }
      }
    }
  `);
  console.log(JSON.stringify(schema, null, 2));
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

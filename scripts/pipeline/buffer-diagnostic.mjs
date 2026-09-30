#!/usr/bin/env node
// One-off diagnostic, not a pipeline stage: exercises the real, schema-
// confirmed createPin() (scripts/lib/buffer.mjs) end to end against
// Buffer's live API. Meant to be deleted once this and the real pipeline
// integration are both confirmed working (see scripts/lib/buffer.mjs's
// header comment for the full introspection trace that got here).
//
// NOT read-only: this creates a real draft in Buffer's queue (default
// createPin() options: needsApproval: true, saveToDraft: true), so it
// does NOT publish to Pinterest. It uses a real, already-committed pin
// image (an existing pipeline-generated draft, fetched via its public
// raw.githubusercontent.com URL) and real Pinterest-pin-shaped text, but
// this is still a one-off connectivity/shape test, not something meant
// to reach a real Pinterest board.
//
// Usage: node scripts/pipeline/buffer-diagnostic.mjs

import { loadEnv } from '../lib/env.mjs';
import { bufferGraphQLRaw } from '../lib/buffer.mjs';

loadEnv();

// Round 2's real createPin() call got PAST GraphQL validation entirely --
// no shape errors -- but the actual result was
// { __typename: "InvalidInputError" }: PostActionPayload is a UNION, and
// Buffer rejected the *semantic content* of our input, not its shape.
// The prime suspect: this call passed no boardServiceId (Pinterest pins
// need a board), and this file never had a real board id to give it. This
// round introspects PostActionPayload as a union (its real possibleTypes)
// and InvalidInputError's fields (for the actual rejection reason/detail),
// and also fetches this channel's real boards so a follow-up call can
// supply a real boardServiceId.
async function run() {
  console.log('Introspecting PostActionPayload (union) and InvalidInputError...');
  const types = await bufferGraphQLRaw(`
    query {
      payload: __type(name: "PostActionPayload") {
        kind
        possibleTypes { name }
      }
      invalidInput: __type(name: "InvalidInputError") {
        fields { name type { name kind ofType { name kind } } }
      }
    }
  `);
  console.log(JSON.stringify(types, null, 2));

  // Channel itself has no `boards` field (confirmed by its earlier full
  // introspection -- see buffer.mjs's history), but it does have
  // `metadata: ChannelMetadata`, a union -- the per-service variant
  // (e.g. a PinterestChannelMetadata) is the more likely home for a
  // board list. Introspect the union's possible types, then fetch this
  // channel's real metadata to see which variant it actually returns.
  console.log('\nIntrospecting ChannelMetadata union...');
  const metadataUnion = await bufferGraphQLRaw(`
    query {
      __type(name: "ChannelMetadata") {
        kind
        possibleTypes { name }
      }
    }
  `);
  console.log(JSON.stringify(metadataUnion, null, 2));

  const pinterestMetaType = metadataUnion.data?.__type?.possibleTypes?.find((t) =>
    /pinterest/i.test(t.name),
  )?.name;
  if (pinterestMetaType) {
    console.log(`\nIntrospecting ${pinterestMetaType}...`);
    const fields = await bufferGraphQLRaw(`
      query {
        __type(name: "${pinterestMetaType}") {
          fields { name type { name kind ofType { name kind ofType { name kind } } } }
        }
      }
    `);
    console.log(JSON.stringify(fields, null, 2));
  }
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

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

// Round 4 hit two real errors: (1) the introspection query for
// boards' item type wasn't nested deep enough (boards: NON_NULL(LIST(
// NON_NULL(<item>))) needs 3 ofType levels, this round's query only had
// 2, so the item type's name came back null) and (2) `channel` takes
// `input: ChannelInput!`, not a bare `id` arg ("Unknown argument \"id\"
// on field \"Query.channel\""). This round fixes both: one more ofType
// level for the item type name, and introspects ChannelInput's real
// shape before retrying the real board-list fetch.
const PINTEREST_CHANNEL_ID = '6abc9d67ea19ca0bde2eebce';

async function run() {
  console.log("Introspecting PinterestMetadata.boards' item type (one level deeper)...");
  const boardsField = await bufferGraphQLRaw(`
    query {
      __type(name: "PinterestMetadata") {
        fields {
          name
          type { ofType { ofType { name kind ofType { name kind } } } }
        }
      }
    }
  `);
  console.log(JSON.stringify(boardsField, null, 2));

  const boardsType = boardsField.data?.__type?.fields?.find((f) => f.name === 'boards')?.type;
  const boardTypeName = boardsType?.ofType?.ofType?.name ?? boardsType?.ofType?.ofType?.ofType?.name;

  if (boardTypeName) {
    console.log(`\nIntrospecting ${boardTypeName}'s fields...`);
    const boardType = await bufferGraphQLRaw(`
      query {
        __type(name: "${boardTypeName}") {
          fields { name type { name kind ofType { name kind } } }
        }
      }
    `);
    console.log(JSON.stringify(boardType, null, 2));
  }

  console.log('\nIntrospecting ChannelInput...');
  const channelInputType = await bufferGraphQLRaw(`
    query {
      __type(name: "ChannelInput") {
        inputFields { name type { name kind ofType { name kind } } }
      }
    }
  `);
  console.log(JSON.stringify(channelInputType, null, 2));

  console.log(`\nFetching real boards for channel ${PINTEREST_CHANNEL_ID}...`);
  const channelData = await bufferGraphQLRaw(
    `
    query ($input: ChannelInput!) {
      channel(input: $input) {
        id
        metadata {
          ... on PinterestMetadata {
            boards { id name }
          }
        }
      }
    }
  `,
    { input: { id: PINTEREST_CHANNEL_ID } },
  );
  console.log(JSON.stringify(channelData, null, 2));
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

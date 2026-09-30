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

// Round 3 confirmed: PostActionPayload's union members include
// InvalidInputError { message: String! } (so a fragment spread on it
// gets the real rejection reason), and ChannelMetadata's Pinterest
// variant is PinterestMetadata { boards: [<board type>!]! } -- exactly
// the board list this integration needs. This round introspects the
// board list's item type, then fetches this channel's real boards via
// the root `channel(id:)` query (confirmed to exist, singular, from the
// earlier root-Query-fields introspection).
const PINTEREST_CHANNEL_ID = '6abc9d67ea19ca0bde2eebce';

async function run() {
  console.log("Introspecting PinterestMetadata.boards' item type...");
  const boardsField = await bufferGraphQLRaw(`
    query {
      __type(name: "PinterestMetadata") {
        fields {
          name
          type { ofType { ofType { name kind } } }
        }
      }
    }
  `);
  console.log(JSON.stringify(boardsField, null, 2));

  const boardTypeName = boardsField.data?.__type?.fields?.find((f) => f.name === 'boards')?.type
    ?.ofType?.ofType?.name;

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

  console.log(`\nFetching real boards for channel ${PINTEREST_CHANNEL_ID}...`);
  const channelData = await bufferGraphQLRaw(
    `
    query ($id: ChannelId!) {
      channel(id: $id) {
        id
        metadata {
          ... on PinterestMetadata {
            boards { id name }
          }
        }
      }
    }
  `,
    { id: PINTEREST_CHANNEL_ID },
  );
  console.log(JSON.stringify(channelData, null, 2));
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

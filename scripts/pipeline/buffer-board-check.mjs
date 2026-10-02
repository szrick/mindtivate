#!/usr/bin/env node
// One-off, temporary, read-only: lists every board Buffer's connected
// Pinterest channel currently sees, to confirm whether the real
// category boards (scripts/lib/pinterest-boards.json) are visible to
// Buffer -- not just "Mindtivate Test Board", the only one an earlier
// check returned. Delete after use.

import { loadEnv } from '../lib/env.mjs';
import { bufferGraphQLRaw } from '../lib/buffer.mjs';

loadEnv();

const PINTEREST_CHANNEL_ID = '6abc9d67ea19ca0bde2eebce';

async function run() {
  const result = await bufferGraphQLRaw(
    `
    query ($input: ChannelInput!) {
      channel(input: $input) {
        id
        metadata {
          ... on PinterestMetadata {
            boards { id serviceId name }
          }
        }
      }
    }
  `,
    { input: { id: PINTEREST_CHANNEL_ID } },
  );
  console.log(JSON.stringify(result, null, 2));
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

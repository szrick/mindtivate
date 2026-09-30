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
import { createPin } from '../lib/buffer.mjs';

loadEnv();

const PINTEREST_CHANNEL_ID = '6abc9d67ea19ca0bde2eebce';
const TEST_IMAGE_URL =
  'https://raw.githubusercontent.com/szrick/mindtivate/main/scripts/pipeline/pinterest-pin-drafts/should-you-add-myoinositol-to-metformin-for-pcos.png';

// Round 5 found a real board (Buffer id 6abc9d686ddb439218f36912, name
// "Mindtivate Test Board") via channel(input:).metadata on PinterestMetadata
// -- but PinterestBoard has BOTH an `id` (Buffer's internal id) and a
// `serviceId` (same id/serviceId split pattern as Channel itself, where
// serviceId is Pinterest's own native id). PinterestPostMetadataInput's
// field is named `boardServiceId`, strongly suggesting it wants the
// latter. This round fetches serviceId too, then makes the real,
// hopefully-final createPin() call with a real board attached.
async function run() {
  console.log('Fetching this channel\'s real board (with serviceId)...');
  const channelData = await bufferGraphQLRaw(
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
  console.log(JSON.stringify(channelData, null, 2));

  const board = channelData.data?.channel?.metadata?.boards?.[0];
  if (!board) {
    console.log('No board found -- stopping here.');
    return;
  }

  console.log(`\nCalling createPin() with real boardServiceId=${board.serviceId}...`);
  const result = await createPin({
    title: '[Buffer integration test -- safe to delete] Should You Add Myoinositol to Metformin for PCOS?',
    description: '[Buffer integration test -- safe to delete] Verifying the Buffer createPost mutation shape end to end.',
    link: 'https://mindtivate.com/articles/should-you-add-myoinositol-to-metformin-for-pcos/',
    imageUrl: TEST_IMAGE_URL,
    boardServiceId: board.serviceId,
  });
  console.log('createPin() result:', JSON.stringify(result, null, 2));
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

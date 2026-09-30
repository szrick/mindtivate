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
import { createPin, bufferGraphQLRaw } from '../lib/buffer.mjs';

loadEnv();

const TEST_IMAGE_URL =
  'https://raw.githubusercontent.com/szrick/mindtivate/main/scripts/pipeline/pinterest-pin-drafts/should-you-add-myoinositol-to-metformin-for-pcos.png';

// First real (non-introspection) createPin() call validated the entire
// mutation input -- channelId, assets, metadata.pinterest, everything --
// with zero complaints. The only error was the response selection:
// createPost returns PostActionPayload, not a Post with `id`. Rather
// than guess PostActionPayload's real fields too, introspect it first.
async function run() {
  console.log('Introspecting PostActionPayload (createPost\'s real return type)...');
  const payloadType = await bufferGraphQLRaw(`
    query {
      __type(name: "PostActionPayload") {
        fields { name type { name kind ofType { name kind } } }
      }
    }
  `);
  console.log('PostActionPayload:', JSON.stringify(payloadType, null, 2));

  console.log('\nCalling createPin() for real (draft only -- needsApproval: true, saveToDraft: true)...');
  const result = await createPin({
    title: '[Buffer integration test -- safe to delete] Should You Add Myoinositol to Metformin for PCOS?',
    description: '[Buffer integration test -- safe to delete] Verifying the Buffer createPost mutation shape end to end.',
    link: 'https://mindtivate.com/articles/should-you-add-myoinositol-to-metformin-for-pcos/',
    imageUrl: TEST_IMAGE_URL,
  });
  console.log('createPin() result:', JSON.stringify(result, null, 2));
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

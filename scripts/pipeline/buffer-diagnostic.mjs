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

// Round 8 confirmed AssetInput is a one-of wrapper (document/image/video,
// each its own input type) and PostInputMetaData has a per-service field
// including `pinterest: PinterestPostMetadataInput` -- exactly where a
// pin's board id belongs, confirming the shape guess from this file's
// header comment. This (likely final) round introspects ImageAssetInput
// (how an image URL attaches) and PinterestPostMetadataInput (board id
// and whatever else a pin needs) to have everything for the real mutation.
async function run() {
  const typeNames = ['ImageAssetInput', 'PinterestPostMetadataInput'];
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

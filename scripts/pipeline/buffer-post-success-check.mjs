#!/usr/bin/env node
// One-off, temporary: introspects PostActionSuccess's fields to see
// whether createPost's success response includes the created post's id
// or a Pinterest pin URL -- needed to keep recording pinterestPinUrl on
// articles once 5-pinterest-pin.mjs's sendDraft() switches to Buffer.
// Read-only. Delete after use.

import { loadEnv } from '../lib/env.mjs';
import { bufferGraphQLRaw } from '../lib/buffer.mjs';

loadEnv();

async function run() {
  // Round 1 confirmed PostActionSuccess { post: Post! } -- this round
  // introspects Post's own fields to find the real Pinterest post/pin
  // id or URL to record as pinterestPinUrl.
  const result = await bufferGraphQLRaw(`
    query {
      __type(name: "Post") {
        fields {
          name
          type { name kind ofType { name kind ofType { name kind } } }
        }
      }
    }
  `);
  console.log(JSON.stringify(result, null, 2));
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

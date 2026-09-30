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

// Rounds 1-5 (see PR history) confirmed real, working reads: the account's
// organizationId (6abc9d21a3325fb2b8a972ed) and the connected Pinterest
// channel's id (6abc9d67ea19ca0bde2eebce, service "pinterest", serviceId/
// name/displayName all "mindtivate"). Round 6 introspected the root
// Mutation type and found `createPost` -- the real posting mutation. This
// round introspects createPost's own arguments and, recursively, its
// input type's fields (one level of nested input types too, since a
// create-post shape is likely to nest e.g. `content { text, media }`).
async function run() {
  console.log("Introspecting Buffer schema (Mutation.createPost's args)...");
  const schema = await bufferGraphQLRaw(`
    query {
      mutationType: __type(name: "Mutation") {
        fields {
          name
          args {
            name
            type { name kind ofType { name kind ofType { name kind } } }
          }
        }
      }
    }
  `);
  const createPost = schema.data?.mutationType?.fields?.find((f) => f.name === 'createPost');
  console.log('createPost field:', JSON.stringify(createPost, null, 2));

  const inputTypeNames = new Set();
  for (const arg of createPost?.args ?? []) {
    const n = arg.type?.name ?? arg.type?.ofType?.name ?? arg.type?.ofType?.ofType?.name;
    if (n) inputTypeNames.add(n);
  }

  for (const typeName of inputTypeNames) {
    const inputType = await bufferGraphQLRaw(`
      query {
        __type(name: "${typeName}") {
          name
          inputFields {
            name
            type { name kind ofType { name kind ofType { name kind ofType { name kind } } } }
          }
        }
      }
    `);
    console.log(`${typeName} input type:`, JSON.stringify(inputType, null, 2));
  }
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

#!/usr/bin/env node
// One-off diagnostic: Buffer's createPost mutation returning
// PostActionSuccess only confirms Buffer *accepted* the post, not that
// it actually went live on Pinterest (schedulingType: 'automatic' means
// Buffer's own queue processes it afterwards, and that can fail
// asynchronously). This introspects the GraphQL schema for a way to
// list a channel's recent posts and their real status, then (once the
// right query is known) prints them -- see buffer.mjs's header comment
// for why introspection, not docs, is how this schema gets discovered.
//
// Usage: node scripts/pipeline/debug-buffer-posts.mjs

import { loadEnv } from '../lib/env.mjs';
import { bufferGraphQLRaw, findPinterestChannel } from '../lib/buffer.mjs';

loadEnv();

async function introspectType(name) {
  const result = await bufferGraphQLRaw(`
    query {
      __type(name: "${name}") {
        name
        fields {
          name
          args { name type { name kind ofType { name kind ofType { name kind } } } }
          type { name kind ofType { name kind } }
        }
        enumValues { name }
      }
    }
  `);
  return result;
}

async function main() {
  const channel = await findPinterestChannel();
  console.log('Pinterest channel:', JSON.stringify(channel, null, 2));

  console.log('\n--- Query.posts args + PostsResults/PostStatus shapes ---');
  console.log(JSON.stringify(await introspectType('PostsResults'), null, 2));
  console.log(JSON.stringify(await introspectType('PostStatus'), null, 2));
  console.log(JSON.stringify(await introspectType('PostsInput'), null, 2));

  // Query.posts's own args (filtered out of the full Query dump -- that
  // type is huge and mostly irrelevant here).
  const queryType = await introspectType('Query');
  const postsField = queryType.data?.__type?.fields?.find((f) => f.name === 'posts');
  console.log('\n--- Query.posts field (args only) ---');
  console.log(JSON.stringify(postsField, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

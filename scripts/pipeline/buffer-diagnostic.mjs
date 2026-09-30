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

// Round 1 (see PR history) hit two wrong field-name/argument guesses.
// Round 2 introspected Channel + ChannelsInput directly and got the real
// shape: `channels(input: ChannelsInput!)` needs `organizationId:
// OrganizationId!` (required) plus an optional `filter`. Round 3
// introspected the root Query type's field names to find where
// organizationId comes from -- `account` is the standout candidate (no
// other field name suggests an account/org context). This round
// introspects `account`'s own arguments (does it need an id, or is it
// implicit from the API key?) and its return type's fields, to confirm
// and get the real path to organizationId.
async function run() {
  console.log("Introspecting Buffer schema (Query.account's args + its return type's fields)...");
  const schema = await bufferGraphQLRaw(`
    query {
      queryType: __type(name: "Query") {
        fields(includeDeprecated: true) {
          name
          args { name type { name kind ofType { name kind } } }
          type { name kind ofType { name kind } }
        }
      }
    }
  `);
  const accountField = schema.data?.queryType?.fields?.find((f) => f.name === 'account');
  console.log('account field:', JSON.stringify(accountField, null, 2));

  const accountTypeName = accountField?.type?.name ?? accountField?.type?.ofType?.name;
  if (accountTypeName) {
    const accountType = await bufferGraphQLRaw(`
      query {
        __type(name: "${accountTypeName}") {
          name
          fields { name type { name kind ofType { name kind } } }
        }
      }
    `);
    console.log(`${accountTypeName} type:`, JSON.stringify(accountType, null, 2));
  }
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

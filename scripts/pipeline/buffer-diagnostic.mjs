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
import { listChannels } from '../lib/buffer.mjs';

loadEnv();

async function run() {
  console.log('Fetching Buffer channels...');
  const channels = await listChannels();
  console.log(`Found ${channels.length} connected channel(s):`);
  for (const c of channels) {
    console.log(`  - id=${c.id} service=${c.service} username=${c.serviceUsername}`);
  }
  const pinterest = channels.find((c) => c.service?.toLowerCase() === 'pinterest');
  if (pinterest) {
    console.log(`\nPinterest channel found: id=${pinterest.id}`);
  } else {
    console.log('\nNo Pinterest channel found -- connect it in Buffer\'s dashboard first.');
  }
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

#!/usr/bin/env node
// One-off debugging helper: hits Poe's chat-completions endpoint directly
// with a candidate image-gen bot handle and prints the raw response, so
// you can find a working POE_IMAGE_MODEL / POE_SEARCH_MODEL value without
// running the full pipeline (and its other Poe calls) each time.
//
// Usage:
//   node scripts/pipeline/debug-poe-image.mjs "GPT-Image-1"
//   node scripts/pipeline/debug-poe-image.mjs "FLUX-pro-1.1" "a red circle on a white background"

import { loadEnv } from '../lib/env.mjs';

loadEnv();

const model = process.argv[2];
const prompt = process.argv[3] || 'A simple flat illustration of a red circle on a white background, no text.';

if (!model) {
  console.error('Usage: node scripts/pipeline/debug-poe-image.mjs "<bot handle>" ["prompt"]');
  process.exitCode = 1;
} else {
  const apiKey = process.env.POE_API_KEY;
  if (!apiKey) {
    console.error('Missing POE_API_KEY in .env');
    process.exitCode = 1;
  } else {
    console.log(`Trying model="${model}"...`);
    const res = await fetch('https://api.poe.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }] }),
    });
    console.log('HTTP status:', res.status);
    const text = await res.text();
    console.log('Raw body:\n', text);
  }
}

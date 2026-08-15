#!/usr/bin/env node
// Stage 2: turn each researched pain point into a product brief — a
// category and search query a human (or a browsing-capable agent) can use
// to find and apply for an actual affiliate program. This stage does NOT
// fabricate a product or an affiliate link: creating an accurate product
// record with a real, approved affiliate URL is a human step, tracked via
// `affiliateStatus` in src/content/products/*.md and the Pages CMS UI.
//
// Usage: npm run pipeline:match [path-to-research.json]

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { loadEnv } from '../lib/env.mjs';
import { askPoeForJson } from '../lib/poe.mjs';

loadEnv();

function latestResearchFile() {
  const dir = 'scripts/pipeline/output';
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir).filter((f) => f.startsWith('research-') && f.endsWith('.json'));
  if (files.length === 0) return null;
  files.sort();
  return `${dir}/${files.at(-1)}`;
}

const SYSTEM_PROMPT = `You help a women's fitness/wellness editorial team turn a Reddit pain
point into a product research brief. You never invent a specific brand,
model, or purchase link — you only suggest a product category and a
concrete search query a researcher can use to find and vet a real product.
Respond with strict JSON only, no prose, matching this shape:
{"category": "Equipment" | "Apparel" | "Supplement" | "App / Program" | "Book" | "Wearable",
 "searchQuery": string,
 "problemSolved": string,
 "rationale": string}`;

async function briefFor(painPoint) {
  const prompt = `Reddit pain point from r/${painPoint.subreddit}:\nTitle: ${painPoint.title}\nDetail: ${painPoint.selftextExcerpt}\n\nProduce the JSON brief.`;
  return askPoeForJson({ system: SYSTEM_PROMPT, prompt, maxTokens: 400 });
}

async function run() {
  const inputPath = process.argv[2] || latestResearchFile();
  if (!inputPath) {
    console.error('No research file found. Run `npm run pipeline:research` first.');
    process.exitCode = 1;
    return;
  }

  const painPoints = JSON.parse(readFileSync(inputPath, 'utf8'));
  console.log(`Matching ${painPoints.length} pain points from ${inputPath}...`);

  const briefs = [];
  for (const painPoint of painPoints) {
    try {
      const brief = await briefFor(painPoint);
      briefs.push({ painPoint, brief });
      console.log(`  [${painPoint.subreddit}] "${painPoint.title.slice(0, 60)}..." -> ${brief.category}: ${brief.searchQuery}`);
    } catch (err) {
      console.warn(`  skipped (Poe error): ${painPoint.title.slice(0, 60)}... — ${err.message}`);
    }
  }

  mkdirSync('scripts/pipeline/output', { recursive: true });
  const outPath = `scripts/pipeline/output/product-briefs-${Date.now()}.json`;
  writeFileSync(outPath, JSON.stringify(briefs, null, 2));
  console.log(`\nWrote ${briefs.length} product briefs to ${outPath}`);
  console.log('Next: research each brief, apply for the relevant affiliate program, then');
  console.log('add/update a product record in src/content/products/ (via Pages CMS or git)');
  console.log('with affiliateStatus and affiliateUrl set once approved.');
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

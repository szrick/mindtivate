#!/usr/bin/env node
// Stage 5: create a Pinterest pin for a published article and link back to
// mindtivate.com. Run this manually after an article is live (it needs a
// publicly reachable hero image URL, so it only makes sense post-deploy).
//
// Usage: npm run pipeline:pin -- --slug some-article-slug [--image https://mindtivate.com/images/xyz.jpg]

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { loadEnv } from '../lib/env.mjs';
import { createPin } from '../lib/pinterest.mjs';
import { readFrontmatter } from '../lib/frontmatter.mjs';

loadEnv();

const SITE_URL = 'https://mindtivate.com';

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--slug') args.slug = argv[++i];
    else if (argv[i] === '--image') args.image = argv[++i];
  }
  return args;
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.slug) {
    console.error('Usage: npm run pipeline:pin -- --slug <article-slug> [--image <url>]');
    process.exitCode = 1;
    return;
  }

  const filePath = `src/content/articles/${args.slug}.md`;
  if (!existsSync(filePath)) {
    console.error(`No article found at ${filePath}`);
    process.exitCode = 1;
    return;
  }

  const { data } = readFrontmatter(readFileSync(filePath, 'utf8'));
  if (data.status !== 'published') {
    console.error(`Article status is "${data.status}", not "published". Publish it before pinning.`);
    process.exitCode = 1;
    return;
  }

  const imageUrl = args.image || `${SITE_URL}/og-default.svg`;
  const link = `${SITE_URL}/articles/${args.slug}/`;

  console.log(`Creating Pinterest pin for ${link}...`);
  const pin = await createPin({
    title: data.title,
    description: data.description,
    link,
    imageUrl,
  });

  const pinUrl = `https://www.pinterest.com/pin/${pin.id}/`;
  console.log(`Created pin: ${pinUrl}`);
  console.log(`Add "pinterestPinUrl: ${pinUrl}" to ${filePath} (via Pages CMS or git) to record it.`);
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

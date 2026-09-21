#!/usr/bin/env node
// Prints the slug of every published article with no pinterestPinUrl yet
// AND no existing draft file, one per line. Used by
// weekly-pinterest-pins.yml to find what needs a pin drafted -- not a
// pipeline "stage" itself, just a small finder.
//
// Skipping slugs that already have a draft (regardless of approved/sent
// state) matters for two reasons: it stops the weekly schedule from
// wastefully re-drafting (burning Poe credits) the same top-N unapproved
// articles every run if nobody's gotten to reviewing them yet, and it's
// what makes repeated workflow_dispatch calls for a bulk backfill (e.g.
// "draft the rest in batches") actually advance through the full list
// instead of reselecting the same slugs each time.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { readFrontmatter } from '../lib/frontmatter.mjs';

const ARTICLES_DIR = 'src/content/articles';
const DRAFTS_DIR = 'scripts/pipeline/pinterest-pin-drafts';

for (const file of readdirSync(ARTICLES_DIR)) {
  if (!file.endsWith('.md')) continue;
  const slug = file.replace(/\.md$/, '');
  const { data } = readFrontmatter(readFileSync(`${ARTICLES_DIR}/${file}`, 'utf8'));
  if (data.status === 'published' && !data.pinterestPinUrl && !existsSync(`${DRAFTS_DIR}/${slug}.json`)) {
    console.log(slug);
  }
}

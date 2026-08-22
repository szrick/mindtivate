#!/usr/bin/env node
// Prints the slug of every published article with no pinterestPinUrl yet,
// one per line. Used by weekly-pinterest-pins.yml to find what needs a
// pin drafted — not a pipeline "stage" itself, just a small finder.

import { readdirSync, readFileSync } from 'node:fs';
import { readFrontmatter } from '../lib/frontmatter.mjs';

const ARTICLES_DIR = 'src/content/articles';

for (const file of readdirSync(ARTICLES_DIR)) {
  if (!file.endsWith('.md')) continue;
  const { data } = readFrontmatter(readFileSync(`${ARTICLES_DIR}/${file}`, 'utf8'));
  if (data.status === 'published' && !data.pinterestPinUrl) {
    console.log(file.replace(/\.md$/, ''));
  }
}

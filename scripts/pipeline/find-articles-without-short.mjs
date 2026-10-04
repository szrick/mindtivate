#!/usr/bin/env node
// Prints the slug of every published article with no youtubeShortUrl yet
// AND no existing draft file, one per line. Used by
// weekly-youtube-shorts.yml to find what needs a Short drafted -- same
// shape and reasoning as find-unpinned-articles.mjs, just for stage 12.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { readFrontmatter } from '../lib/frontmatter.mjs';

const ARTICLES_DIR = 'src/content/articles';
const DRAFTS_DIR = 'scripts/pipeline/youtube-short-drafts';

for (const file of readdirSync(ARTICLES_DIR)) {
  if (!file.endsWith('.md')) continue;
  const slug = file.replace(/\.md$/, '');
  const { data } = readFrontmatter(readFileSync(`${ARTICLES_DIR}/${file}`, 'utf8'));
  if (data.status === 'published' && !data.youtubeShortUrl && !existsSync(`${DRAFTS_DIR}/${slug}.json`)) {
    console.log(slug);
  }
}

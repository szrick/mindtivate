#!/usr/bin/env node
// Prints the slug of every published article that has a sourceThreadUrl
// (something to comment on) but no redditCommentUrl yet (hasn't been
// commented on), one per line. Used by weekly-reddit-comment-drafts.yml
// to find what needs a comment drafted — not a pipeline "stage" itself,
// just a small finder.
//
// Never lists an article whose sourceSubreddit is one of the
// permanently research-only subreddits documented in docs/COMPLIANCE.md
// (mental-health and other emotionally vulnerable communities) — that
// policy applies regardless of automation, so it's enforced here rather
// than relying on a human catching it during review.

import { readdirSync, readFileSync } from 'node:fs';
import { readFrontmatter } from '../lib/frontmatter.mjs';

const ARTICLES_DIR = 'src/content/articles';

// Keep this in sync with docs/COMPLIANCE.md's "Extra caution" list.
const NEVER_COMMENT_SUBREDDITS = new Set([
  'mentalhealth',
  'Anxiety',
  'relationship_advice',
  'PCOS',
  'Menopause',
  'WomensHealth',
]);

function subredditName(value) {
  return (value || '').replace(/^r\//i, '').trim();
}

for (const file of readdirSync(ARTICLES_DIR)) {
  if (!file.endsWith('.md')) continue;
  const { data } = readFrontmatter(readFileSync(`${ARTICLES_DIR}/${file}`, 'utf8'));
  if (data.status !== 'published') continue;
  if (!data.sourceThreadUrl || data.redditCommentUrl) continue;
  if (NEVER_COMMENT_SUBREDDITS.has(subredditName(data.sourceSubreddit))) continue;
  console.log(file.replace(/\.md$/, ''));
}

#!/usr/bin/env node
// Stage 1: scan target subreddits for recurring, specific problems worth
// writing about. Writes a JSON file of candidate pain points for stage 2.
//
// Reads from Arctic Shift (see scripts/lib/arcticshift.mjs) rather than
// Reddit's own API — no Reddit developer-app approval or account needed
// for this stage. See docs/SETUP.md for why.
//
// Usage: npm run pipeline:research

import { mkdirSync, writeFileSync } from 'node:fs';
import { loadEnv } from '../lib/env.mjs';
import { fetchSubredditPosts, permalinkFor } from '../lib/arcticshift.mjs';

loadEnv();

const TARGET_SUBREDDITS = ['loseit', 'xxfitness', 'bodyweightfitness', 'nutrition', 'mentalhealth'];

// Heuristics for "this is a recurring, answerable problem" rather than a
// vent post, a personal medical question, or a moderator announcement.
const PAIN_SIGNAL_PATTERNS = [
  /\brecommend/i,
  /\bsuggestions?\b/i,
  /\bwhat should i\b/i,
  /\bhow do i\b/i,
  /\bany(one)? (tips|advice)\b/i,
  /\bstruggling with\b/i,
  /\bcan'?t (find|figure out)\b/i,
  /\bhelp( me)?\b.*\?/i,
  /\bworth it\??$/i,
];

const EXCLUDE_PATTERNS = [/\bmegathread\b/i, /\bmod(erator)? /i, /\bdaily thread\b/i];

function looksLikePainPoint(post) {
  const text = `${post.title} ${post.selftext ?? ''}`;
  if (EXCLUDE_PATTERNS.some((re) => re.test(text))) return false;
  return PAIN_SIGNAL_PATTERNS.some((re) => re.test(text));
}

async function run() {
  const results = [];

  for (const subreddit of TARGET_SUBREDDITS) {
    console.log(`Scanning r/${subreddit}...`);
    // Arctic Shift has no "hot"/"top" ranking, only chronological — pull
    // the most recent 100 (its per-request max) and let the pain-point
    // heuristic + engagement threshold below do the real filtering.
    const recent = await fetchSubredditPosts(subreddit, { limit: 100 });

    const candidates = recent
      .filter(looksLikePainPoint)
      .filter((post) => post.num_comments >= 5) // some engagement = a real recurring question
      .sort((a, b) => b.num_comments - a.num_comments)
      .slice(0, 10)
      .map((post) => ({
        subreddit,
        title: post.title,
        url: `https://www.reddit.com${permalinkFor(post)}`,
        selftextExcerpt: (post.selftext ?? '').slice(0, 500),
        score: post.score,
        numComments: post.num_comments,
        createdUtc: post.created_utc,
      }));

    results.push(...candidates);
    console.log(`  found ${candidates.length} candidate pain points`);
  }

  mkdirSync('scripts/pipeline/output', { recursive: true });
  const outPath = `scripts/pipeline/output/research-${Date.now()}.json`;
  writeFileSync(outPath, JSON.stringify(results, null, 2));
  console.log(`\nWrote ${results.length} candidate pain points to ${outPath}`);
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

export { looksLikePainPoint };

#!/usr/bin/env node
// Stage 1: scan target subreddits for recurring, specific problems worth
// writing about. Writes a JSON file of candidate pain points for stage 2.
//
// Reads from Arctic Shift (see scripts/lib/arcticshift.mjs) rather than
// Reddit's own API — no Reddit developer-app approval or account needed
// for this stage. See docs/SETUP.md for why.
//
// Usage:
//   npm run pipeline:research
//   npm run pipeline:research -- --subreddits loseit,xxfitness,nutrition
//   npm run pipeline:research -- --subreddits loseit --query "weight loss"
//
// --subreddits scopes the scan to a comma-separated list instead of the
// default DEFAULT_SUBREDDITS. --query switches from a plain chronological
// scan to Arctic Shift's keyword search (title + selftext) within each
// scoped subreddit, for a topic-focused batch (e.g. a weight-loss push).

import { mkdirSync, writeFileSync } from 'node:fs';
import { loadEnv } from '../lib/env.mjs';
import { fetchSubredditPosts, searchSubreddit, permalinkFor } from '../lib/arcticshift.mjs';

loadEnv();

// Covers all 8 site categories (src/lib/categories.ts) — xxfitness=Body
// (strength + bodyweight + general fitness content all show up there),
// nutrition=Food, mentalhealth=Mind, WomensHealth=Hormones,
// relationship_advice=Love, SkincareAddiction=Beauty, sleep=Sleep. Life
// Stages has no single well-established dedicated subreddit — AskWomen
// is the broadest reasonable fit (postpartum/aging/decade-specific
// threads show up there), but it's the weakest-targeted mapping of the
// 8; consider --subreddits for a more specific one-off batch (e.g.
// r/Mommit for a postpartum-focused run).
const DEFAULT_SUBREDDITS = [
  'xxfitness',
  'nutrition',
  'mentalhealth',
  'WomensHealth',
  'relationship_advice',
  'SkincareAddiction',
  'sleep',
  'AskWomen',
];

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--subreddits') args.subreddits = argv[++i].split(',').map((s) => s.trim());
    else if (argv[i] === '--query') args.query = argv[++i];
  }
  return args;
}

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
  const args = parseArgs(process.argv.slice(2));
  const targetSubreddits = args.subreddits ?? DEFAULT_SUBREDDITS;
  const results = [];

  for (const subreddit of targetSubreddits) {
    console.log(args.query ? `Searching r/${subreddit} for "${args.query}"...` : `Scanning r/${subreddit}...`);
    // Arctic Shift has no "hot"/"top" ranking, only chronological — pull
    // up to 100 (its per-request max) and let the pain-point heuristic +
    // engagement threshold below do the real filtering. With --query,
    // this is a keyword search (title + selftext) instead of a plain
    // chronological scan, for a topic-focused batch.
    const recent = args.query
      ? await searchSubreddit(subreddit, args.query, { limit: 100 })
      : await fetchSubredditPosts(subreddit, { limit: 100 });

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

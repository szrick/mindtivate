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
// --subreddits overrides the default (a flat custom list, not grouped by
// category — for a one-off topic-scoped batch). --query switches from a
// plain chronological scan to Arctic Shift's keyword search (title +
// selftext) within each scoped subreddit; applies whether you're on the
// default category-grouped list or a custom --subreddits one.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { loadEnv } from '../lib/env.mjs';
import { fetchSubredditPosts, searchSubreddit, permalinkFor } from '../lib/arcticshift.mjs';
import { readFrontmatter } from '../lib/frontmatter.mjs';

loadEnv();

// Every existing article's source thread, category, and source subreddit,
// regardless of status/draft — a pain point already covered (even by a
// draft still waiting on review) shouldn't be drafted again just because
// a later run rescans the same subreddits. Arctic Shift has no memory of
// its own, so this check matters most once this runs daily instead of
// weekly: without it, the same recurring/popular thread could resurface
// run after run. categoryCounts/subredditCounts feed balanceCandidates
// below — deriving rotation state from the existing article corpus each
// run means there's no separate state file to keep in sync or get stale.
function scanExistingArticles() {
  const dir = 'src/content/articles';
  const coveredUrls = new Set();
  const categoryCounts = {};
  const subredditCounts = {};
  if (!existsSync(dir)) return { coveredUrls, categoryCounts, subredditCounts };
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.md'))) {
    const { data } = readFrontmatter(readFileSync(`${dir}/${f}`, 'utf8'));
    if (data.sourceThreadUrl) coveredUrls.add(data.sourceThreadUrl);
    if (data.category) categoryCounts[data.category] = (categoryCounts[data.category] ?? 0) + 1;
    if (data.sourceSubreddit) {
      const key = data.sourceSubreddit.replace(/^r\//, '');
      subredditCounts[key] = (subredditCounts[key] ?? 0) + 1;
    }
  }
  return { coveredUrls, categoryCounts, subredditCounts };
}

// Reorders candidates so drafting (which always takes the first N by
// index — see content-pipeline.yml) spreads across categories and
// subreddits instead of always grabbing whichever happens to be scanned
// first. r/xxfitness is first in DEFAULT_SUBREDDITS_BY_CATEGORY's Body
// entry and reliably has the most qualifying posts, so without this the
// top of the list — and therefore every day's drafts — was almost always
// Body/r/xxfitness.
//
// Within each category, candidates are sorted by ascending existing-
// article count for that specific subreddit (the least-drafted-from
// subreddit surfaces first). Across categories, a round-robin then
// interleaves them in ascending order of existing-article count for that
// category (the least-represented category goes first). Candidates with
// no targetCategory (a custom --subreddits run) are left in their
// original order at the end, unaffected.
function balanceCandidates(candidates, categoryCounts, subredditCounts) {
  const buckets = new Map();
  const uncategorized = [];
  for (const c of candidates) {
    if (!c.targetCategory) {
      uncategorized.push(c);
      continue;
    }
    if (!buckets.has(c.targetCategory)) buckets.set(c.targetCategory, []);
    buckets.get(c.targetCategory).push(c);
  }

  for (const list of buckets.values()) {
    list.sort((a, b) => (subredditCounts[a.subreddit] ?? 0) - (subredditCounts[b.subreddit] ?? 0));
  }

  const categoryPriority = [...buckets.keys()].sort(
    (a, b) => (categoryCounts[a] ?? 0) - (categoryCounts[b] ?? 0)
  );

  const ordered = [];
  let anyLeft = true;
  while (anyLeft) {
    anyLeft = false;
    for (const category of categoryPriority) {
      const bucket = buckets.get(category);
      if (bucket.length > 0) {
        ordered.push(bucket.shift());
        anyLeft = true;
      }
    }
  }
  return [...ordered, ...uncategorized];
}

// 5 subreddits per site category (src/lib/categories.ts), so each
// category draws from a real spread of communities instead of a single
// source. Confidence varies — the first 2-3 per category are
// well-established, high-traffic communities; the rest are real but
// smaller/more niche, so if one consistently returns 0 candidates, it
// may be quieter than expected or worth swapping via --subreddits.
const DEFAULT_SUBREDDITS_BY_CATEGORY = {
  Body: ['xxfitness', 'loseit', 'bodyweightfitness', 'Fitness', 'GYM'],
  Food: ['nutrition', 'EatCheapAndHealthy', 'MealPrepSunday', 'intermittentfasting', 'volumeeating'],
  Mind: ['mentalhealth', 'GetMotivated', 'Anxiety', 'selfimprovement', 'DecidingToBeBetter'],
  Hormones: ['WomensHealth', 'PCOS', 'Menopause', 'period', 'TwoXChromosomes'],
  Love: ['relationship_advice', 'dating_advice', 'relationships', 'Marriage', 'datingoverthirty'],
  Beauty: ['SkincareAddiction', 'MakeupAddiction', 'HaircareScience', '30PlusSkinCare', 'beauty'],
  Sleep: ['sleep', 'insomnia', 'flexibility', 'stretching', 'backpain'],
  'Life Stages': ['AskWomen', 'Mommit', 'beyondthebump', 'AskWomenOver30', 'Parenting'],
};

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

// Scans (or --query searches) one subreddit and returns its filtered,
// tagged candidates. targetCategory is a hint for review/organization —
// stage 3 still assigns the article's actual category itself, this
// doesn't bind it.
async function scanSubreddit(subreddit, query, targetCategory) {
  console.log(
    `  ${query ? `Searching r/${subreddit} for "${query}"` : `Scanning r/${subreddit}`}${targetCategory ? ` (${targetCategory})` : ''}...`
  );
  // Arctic Shift has no "hot"/"top" ranking, only chronological — pull up
  // to 100 (its per-request max) and let the pain-point heuristic +
  // engagement threshold below do the real filtering.
  const recent = query
    ? await searchSubreddit(subreddit, query, { limit: 100 })
    : await fetchSubredditPosts(subreddit, { limit: 100 });

  const candidates = recent
    .filter(looksLikePainPoint)
    .filter((post) => post.num_comments >= 5) // some engagement = a real recurring question
    .sort((a, b) => b.num_comments - a.num_comments)
    .slice(0, 10)
    .map((post) => ({
      ...(targetCategory ? { targetCategory } : {}),
      subreddit,
      title: post.title,
      url: `https://www.reddit.com${permalinkFor(post)}`,
      selftextExcerpt: (post.selftext ?? '').slice(0, 500),
      score: post.score,
      numComments: post.num_comments,
      createdUtc: post.created_utc,
    }));

  console.log(`    found ${candidates.length} candidate pain points`);
  return candidates;
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  const results = [];

  if (args.subreddits) {
    console.log(`Scanning ${args.subreddits.length} custom subreddit(s)...`);
    for (const subreddit of args.subreddits) {
      results.push(...(await scanSubreddit(subreddit, args.query)));
    }
  } else {
    for (const [category, subreddits] of Object.entries(DEFAULT_SUBREDDITS_BY_CATEGORY)) {
      console.log(`\n=== ${category} ===`);
      for (const subreddit of subreddits) {
        results.push(...(await scanSubreddit(subreddit, args.query, category)));
      }
    }
  }

  const { coveredUrls, categoryCounts, subredditCounts } = scanExistingArticles();
  const deduped = results.filter((r) => !coveredUrls.has(r.url));
  const skipped = results.length - deduped.length;
  if (skipped > 0) {
    console.log(`\nSkipped ${skipped} candidate(s) already covered by an existing article.`);
  }

  const balanced = balanceCandidates(deduped, categoryCounts, subredditCounts);

  mkdirSync('scripts/pipeline/output', { recursive: true });
  const outPath = `scripts/pipeline/output/research-${Date.now()}.json`;
  writeFileSync(outPath, JSON.stringify(balanced, null, 2));
  console.log(`\nWrote ${balanced.length} candidate pain points to ${outPath}`);
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

export { looksLikePainPoint };

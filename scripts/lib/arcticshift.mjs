// Minimal Arctic Shift API client (no dependencies, no auth needed).
// https://github.com/ArthurHeitmann/arctic_shift — a free, community-run,
// Pushshift-style Reddit archive. Used for read-only research (stage 1)
// instead of Reddit's own OAuth API, because Reddit now gates new OAuth
// tokens behind manual approval under its Responsible Builder Policy
// (see docs/SETUP.md) — Arctic Shift needs no app, no approval, and no
// Reddit account at all.
//
// Trade-offs vs. the official API: it's third-party community
// infrastructure (no uptime guarantee), data can lag up to ~36 hours
// behind live Reddit, and it has no "hot" ranking — only chronological
// search. None of that matters much for a weekly research scan, which is
// what this pipeline runs.

const API_BASE = 'https://arctic-shift.photon-reddit.com';

// Arctic Shift has no `permalink` field — reconstruct it from `subreddit`
// + `id` instead (Reddit's permalink format is fully deterministic;
// see permalinkFor() below). `url` is the post's outbound link, not its
// reddit.com location, so it's not useful for that purpose.
const POST_FIELDS = [
  'id',
  'title',
  'selftext',
  'score',
  'num_comments',
  'created_utc',
  'subreddit',
  'author',
].join(',');

export function permalinkFor(post) {
  return `/r/${post.subreddit}/comments/${post.id}/`;
}

async function arcticShiftGet(path, params) {
  const url = new URL(`${API_BASE}${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  }
  const res = await fetch(url, {
    headers: { 'User-Agent': process.env.REDDIT_USER_AGENT || 'mindtivate-research/0.1' },
  });
  if (!res.ok) {
    throw new Error(`Arctic Shift GET ${path} failed: ${res.status} ${await res.text()}`);
  }
  const json = await res.json();
  return Array.isArray(json) ? json : (json.data ?? []);
}

/**
 * Fetch recent posts from a subreddit, newest first. There's no "hot"
 * equivalent here (chronological only), so callers should rely on their
 * own engagement/keyword filtering rather than Reddit's ranking.
 */
export async function fetchSubredditPosts(subreddit, { limit = 50 } = {}) {
  return arcticShiftGet('/api/posts/search', {
    subreddit,
    sort: 'desc',
    limit,
    fields: POST_FIELDS,
  });
}

/**
 * Keyword search within a subreddit (matches title + selftext).
 */
export async function searchSubreddit(subreddit, query, { limit = 25 } = {}) {
  return arcticShiftGet('/api/posts/search', {
    subreddit,
    query,
    sort: 'desc',
    limit,
    fields: POST_FIELDS,
  });
}

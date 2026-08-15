// Minimal Reddit API client (no dependencies). Uses a "script" app OAuth
// grant. This is ONLY needed for the optional stage 6 comment-posting
// capability (scripts/pipeline/6-reddit-engagement-draft.mjs) — actually
// posting as a Reddit account inherently requires a real, authenticated
// Reddit session, there's no way around that.
//
// Research (stage 1) no longer uses this file — it reads from Arctic
// Shift instead (see scripts/lib/arcticshift.mjs), because Reddit's own
// API now gates new OAuth tokens behind manual approval under their
// Responsible Builder Policy (see docs/SETUP.md), while Arctic Shift
// needs no approval and no Reddit account at all.
//
// If you do want stage 6's posting capability, create a script app at
// https://www.reddit.com/prefs/apps, get it approved per docs/SETUP.md,
// and set REDDIT_CLIENT_ID / REDDIT_CLIENT_SECRET / REDDIT_USERNAME /
// REDDIT_PASSWORD / REDDIT_USER_AGENT in .env.

const TOKEN_URL = 'https://www.reddit.com/api/v1/access_token';
const API_BASE = 'https://oauth.reddit.com';

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

export async function getRedditToken() {
  const clientId = requireEnv('REDDIT_CLIENT_ID');
  const clientSecret = requireEnv('REDDIT_CLIENT_SECRET');
  const username = requireEnv('REDDIT_USERNAME');
  const password = requireEnv('REDDIT_PASSWORD');
  const userAgent = requireEnv('REDDIT_USER_AGENT');

  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const body = new URLSearchParams({ grant_type: 'password', username, password });

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basicAuth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': userAgent,
    },
    body,
  });

  if (!res.ok) {
    throw new Error(`Reddit auth failed: ${res.status} ${await res.text()}`);
  }

  const data = await res.json();
  return data.access_token;
}

async function redditGet(token, path) {
  const userAgent = requireEnv('REDDIT_USER_AGENT');
  const res = await fetch(`${API_BASE}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'User-Agent': userAgent,
    },
  });
  if (!res.ok) {
    throw new Error(`Reddit GET ${path} failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

/**
 * Resolve a permalink/thread URL to its fullname (t3_xxxxx) so a comment
 * can be posted against it.
 */
export async function fetchThreadInfo(token, threadUrl) {
  const url = new URL(threadUrl);
  const jsonPath = `${url.pathname.replace(/\/?$/, '')}.json`;
  const json = await redditGet(token, jsonPath);
  const post = json[0]?.data?.children?.[0]?.data;
  if (!post) throw new Error(`Could not resolve thread: ${threadUrl}`);
  return { fullname: `t3_${post.id}`, title: post.title };
}

/**
 * Post a comment. Deliberately NOT called anywhere in the automated
 * pipeline — see scripts/pipeline/6-reddit-engagement-draft.mjs and
 * docs/COMPLIANCE.md for why posting stays a manual, human-approved step.
 */
export async function postComment(token, { parentFullname, text }) {
  const userAgent = requireEnv('REDDIT_USER_AGENT');
  const body = new URLSearchParams({
    api_type: 'json',
    thing_id: parentFullname,
    text,
  });
  const res = await fetch(`${API_BASE}/api/comment`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'User-Agent': userAgent,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });
  if (!res.ok) {
    throw new Error(`Reddit comment failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

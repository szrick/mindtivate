// Google PageSpeed Insights API v5 -- used by
// scripts/pipeline/11-analytics-digest.mjs to add mobile/desktop
// performance scores to the daily digest email.
//
// No OAuth/service account needed (unlike Search Console): it's a plain
// GET with an optional `key` query param. Works without a key at a low
// shared quota, which is plenty for the 2 requests/day this needs --
// PAGESPEED_API_KEY is supported (see docs/SETUP.md 7a) mainly to avoid
// occasional 429s from that shared unauthenticated quota, not because a
// key is required.

const API_URL = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed';

/**
 * Fetches the Performance category score and headline Core Web Vitals for
 * one strategy ('mobile' | 'desktop'). Throws on any API error -- the
 * caller decides how to degrade (see 11-analytics-digest.mjs, which treats
 * this section as best-effort and still sends the rest of the digest).
 */
async function fetchOne({ url, strategy, apiKey }) {
  const params = new URLSearchParams({ url, strategy, category: 'performance' });
  if (apiKey) params.set('key', apiKey);

  const res = await fetch(`${API_URL}?${params.toString()}`);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`PageSpeed Insights API error (${strategy}): ${res.status} ${body.slice(0, 500)}`);
  }

  const payload = await res.json();
  const lighthouse = payload.lighthouseResult;
  if (!lighthouse) {
    throw new Error(`PageSpeed Insights API response (${strategy}) had no lighthouseResult.`);
  }

  const score = lighthouse.categories?.performance?.score;
  const audits = lighthouse.audits ?? {};

  return {
    score: score == null ? null : Math.round(score * 100),
    lcp: audits['largest-contentful-paint']?.displayValue ?? 'N/A',
    cls: audits['cumulative-layout-shift']?.displayValue ?? 'N/A',
    tbt: audits['total-blocking-time']?.displayValue ?? 'N/A',
  };
}

/**
 * Fetches both mobile and desktop performance results for `url`
 * (defaults to the site root). Runs the two requests in parallel.
 */
export async function fetchPerformanceScores({ url, apiKey } = {}) {
  const apiKeyValue = apiKey || process.env.PAGESPEED_API_KEY;
  const [mobile, desktop] = await Promise.all([
    fetchOne({ url, strategy: 'mobile', apiKey: apiKeyValue }),
    fetchOne({ url, strategy: 'desktop', apiKey: apiKeyValue }),
  ]);
  return { mobile, desktop };
}

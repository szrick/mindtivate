// Cloudflare Web Analytics via the GraphQL Analytics API
// (https://api.cloudflare.com/client/v4/graphql, Bearer token auth) --
// used by scripts/pipeline/11-analytics-digest.mjs to pull the previous
// day's stats for a daily email digest.
//
// NOTE ON FIELD NAMES: this module was written without a live Cloudflare
// Web Analytics account/token to test against -- the query below
// (rumPageloadEventsAdaptiveGroups, filter/dimension/sum field names)
// matches Cloudflare's documented Web Analytics GraphQL schema as of
// this writing, cross-checked across multiple independent sources, but
// hasn't been exercised against a real siteTag. If the digest script
// ever logs a GraphQL "Cannot query field ..." error, check the current
// schema via the GraphQL Explorer at https://graphql.cloudflare.com (or
// developers.cloudflare.com/analytics/graphql-api/) and adjust the query
// below -- nothing else in this file needs to change.

const API_URL = 'https://api.cloudflare.com/client/v4/graphql';

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

// Inlines filter values directly into the query string rather than using
// typed GraphQL variables -- Cloudflare's own examples are inconsistent
// about the exact scalar type names (String! vs string! vs Time!) across
// docs/community posts, and getting that wrong is a hard query-validation
// error. String values are only ever our own ISO datetimes and a
// server-assigned siteTag, never user input, so there's no injection
// concern in inlining them.
function buildQuery({ accountTag, siteTag, since, until }) {
  const filter = `siteTag: "${siteTag}", datetime_geq: "${since}", datetime_lt: "${until}"`;
  return `{
    viewer {
      accounts(filter: { accountTag: "${accountTag}" }) {
        totals: rumPageloadEventsAdaptiveGroups(limit: 1, filter: { ${filter} }) {
          count
          sum { visits }
        }
        byPath: rumPageloadEventsAdaptiveGroups(limit: 5, orderBy: [count_DESC], filter: { ${filter} }) {
          count
          dimensions { requestPath }
        }
        byReferrer: rumPageloadEventsAdaptiveGroups(limit: 6, orderBy: [count_DESC], filter: { ${filter} }) {
          count
          dimensions { refererHost }
        }
        byCountry: rumPageloadEventsAdaptiveGroups(limit: 5, orderBy: [count_DESC], filter: { ${filter} }) {
          count
          dimensions { countryName }
        }
        byDevice: rumPageloadEventsAdaptiveGroups(limit: 5, orderBy: [count_DESC], filter: { ${filter} }) {
          count
          dimensions { deviceType }
        }
      }
    }
  }`;
}

/**
 * Fetches Web Analytics totals + top-5 breakdowns (page, referrer,
 * country, device type) for the UTC half-open window [since, until).
 * `since`/`until` are ISO datetime strings. Throws on any API/GraphQL
 * error -- the caller (11-analytics-digest.mjs) decides how to surface
 * that (e.g. an email saying the digest failed rather than silence).
 */
export async function fetchDailyStats({ since, until, accountTag, siteTag, apiToken } = {}) {
  const token = apiToken || requireEnv('CF_API_TOKEN');
  const account = accountTag || requireEnv('CF_ACCOUNT_TAG');
  const site = siteTag || requireEnv('CF_SITE_TAG');

  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: buildQuery({ accountTag: account, siteTag: site, since, until }) }),
  });

  if (!res.ok) {
    throw new Error(`Cloudflare GraphQL API error: ${res.status} ${await res.text()}`);
  }

  const payload = await res.json();
  if (payload.errors?.length) {
    throw new Error(`Cloudflare GraphQL error: ${payload.errors.map((e) => e.message).join('; ')}`);
  }

  const account0 = payload.data?.viewer?.accounts?.[0];
  if (!account0) {
    throw new Error('Cloudflare GraphQL response had no account data -- check CF_ACCOUNT_TAG and the API token\'s permissions.');
  }

  const totals = account0.totals?.[0] ?? { count: 0, sum: { visits: 0 } };

  return {
    pageviews: totals.count ?? 0,
    visits: totals.sum?.visits ?? 0,
    topPaths: (account0.byPath ?? []).map((g) => ({ label: g.dimensions.requestPath || '/', count: g.count })),
    topReferrers: (account0.byReferrer ?? []).map((g) => ({ label: g.dimensions.refererHost || '(direct)', count: g.count })),
    topCountries: (account0.byCountry ?? []).map((g) => ({ label: g.dimensions.countryName || 'Unknown', count: g.count })),
    topDevices: (account0.byDevice ?? []).map((g) => ({ label: g.dimensions.deviceType || 'Unknown', count: g.count })),
  };
}

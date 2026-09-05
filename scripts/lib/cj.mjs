// CJ Affiliate (Commission Junction) product sourcing — GraphQL Product
// Search API (https://ads.api.cj.com/query), Bearer-token authenticated
// with a CJ Personal Access Token. See docs/SETUP.md "CJ Affiliate" for
// how to get CJ_PERSONAL_ACCESS_TOKEN / CJ_COMPANY_ID.
//
// CJ's `shoppingProducts` query only ever returns products from
// advertisers your CJ account has already joined and been approved for —
// there is no API to join a new advertiser program; that step is a human
// decision made in CJ's own dashboard (Advertiser Directory -> Apply),
// and approval is the advertiser's call, not something this script can
// do or wait on. So searchCJProducts below is the fully-automatable half
// of sourcing; findAdvertiserCandidates (using `shoppingProductFeeds`,
// which lists every advertiser in the network regardless of join status)
// exists only to hand a human a short list of advertisers worth applying
// to when nothing already-joined matches a brief.
//
// NOTE ON FIELD NAMES: this module was written without a live CJ account
// to test against (the application was still pending) -- the query
// shapes below match CJ's documented Product Search GraphQL schema, but
// if CJ_DEBUG (see cjGraphQL) ever logs a "Cannot query field ..." error,
// check the current schema at
// https://developers.cj.com/graphql/reference/Product%20Search and
// adjust PRODUCT_SEARCH_QUERY / ADVERTISER_FEEDS_QUERY below -- nothing
// else in this file (or its callers) needs to change.
//
// Every exported function here is non-fatal by design (returns
// null/[] rather than throwing) -- a CJ miss just leaves the brief for
// manual research, same as the Amazon/Pexels/Unsplash sourcing elsewhere
// in this pipeline.

const CJ_GRAPHQL_URL = 'https://ads.api.cj.com/query';

async function cjGraphQL(query, variables) {
  const token = process.env.CJ_PERSONAL_ACCESS_TOKEN;
  if (!token) return null;

  const res = await fetch(CJ_GRAPHQL_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`CJ API error: ${res.status} ${await res.text()}`);

  const payload = await res.json();
  if (payload.errors?.length) {
    throw new Error(`CJ GraphQL error: ${payload.errors.map((e) => e.message).join('; ')}`);
  }
  return payload.data;
}

const PRODUCT_SEARCH_QUERY = `
  query MindtivateProductSearch($companyId: ID!, $keywords: String!) {
    shoppingProducts(companyId: $companyId, keywords: $keywords, limit: 10) {
      totalCount
      resultList {
        id
        title
        description
        link
        imageLink
        advertiserId
        advertiserName
        price { amount currency }
      }
    }
  }
`;

const ADVERTISER_FEEDS_QUERY = `
  query MindtivateAdvertiserFeeds($companyId: ID!, $keywords: String!) {
    shoppingProductFeeds(companyId: $companyId, keywords: $keywords, limit: 5) {
      resultList {
        advertiserId
        advertiserName
      }
    }
  }
`;

// A cheap relevance guard so a low-quality top hit doesn't get treated as
// a confirmed match just because CJ returned *something* -- requires at
// least one significant (4+ letter) word from the search query to appear
// in the product title. Search relevance ranking already does the real
// work; this just catches the "totally unrelated top result" case.
function isRelevant(title, keywords) {
  const significantWords = keywords
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length >= 4);
  if (significantWords.length === 0) return true;
  const titleLower = title.toLowerCase();
  return significantWords.some((w) => titleLower.includes(w));
}

/**
 * Searches CJ's Product Search API for `keywords`, restricted to
 * advertisers this CJ account is already joined to (that's a property of
 * the `shoppingProducts` query itself, not a filter this function
 * applies). Returns the best-matching product as
 * { title, description, link, imageLink, advertiserId, advertiserName,
 *   price }, or null if CJ isn't configured, nothing matched, or the API
 * call failed.
 */
export async function searchCJProducts(keywords) {
  const companyId = process.env.CJ_COMPANY_ID;
  if (!companyId || !keywords) return null;

  let data;
  try {
    data = await cjGraphQL(PRODUCT_SEARCH_QUERY, { companyId, keywords });
  } catch (err) {
    console.warn(`  CJ product search failed: ${err.message}`);
    return null;
  }
  if (!data) return null;

  const results = data.shoppingProducts?.resultList ?? [];
  const best = results.find((p) => p.title && isRelevant(p.title, keywords));
  return best ?? null;
}

/**
 * Best-effort: lists a few advertiser names in CJ's network (regardless
 * of join status) whose product feeds match `keywords`, so a human has
 * somewhere concrete to start when no already-joined advertiser has a
 * match. Returns [] on any failure or when CJ isn't configured -- this
 * is a nice-to-have for the "advertisers to consider" report, never
 * worth failing the run over.
 */
export async function findAdvertiserCandidates(keywords) {
  const companyId = process.env.CJ_COMPANY_ID;
  if (!companyId || !keywords) return [];

  try {
    const data = await cjGraphQL(ADVERTISER_FEEDS_QUERY, { companyId, keywords });
    const results = data?.shoppingProductFeeds?.resultList ?? [];
    const seen = new Set();
    const unique = [];
    for (const r of results) {
      if (!r.advertiserName || seen.has(r.advertiserId)) continue;
      seen.add(r.advertiserId);
      unique.push({ advertiserId: r.advertiserId, advertiserName: r.advertiserName });
    }
    return unique;
  } catch (err) {
    console.warn(`  CJ advertiser feed lookup skipped: ${err.message}`);
    return [];
  }
}

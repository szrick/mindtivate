// Real, licensed stock-photo sourcing for article hero images (Pexels +
// Unsplash), as an alternative to Poe-generated ones — see
// generateHeroImage in scripts/pipeline/3-generate-article.mjs for how
// the two are mixed. Both APIs are free-tier, key-gated; get keys at
// https://www.pexels.com/api/ and https://unsplash.com/developers. Every
// function here is non-fatal by design (returns null rather than
// throwing) — a stock-photo miss just falls back to AI generation.
//
// Unsplash's API Guidelines (https://help.unsplash.com/en/articles/2511245)
// require, for every photo actually used: (1) crediting the photographer
// with a link back to their profile, (2) crediting Unsplash itself with a
// link, both carrying UTM parameters, and (3) pinging the photo's
// `download_location` endpoint once when the photo is used (registers the
// download for the photographer's stats — required for eventual
// "Production" API access, which raises the default 50-req/hour demo
// rate limit). ArticleLayout.astro renders the credit line this module
// returns; downloadUnsplashPhoto below fires the tracking ping.
// Pexels' license doesn't legally require attribution, but crediting is
// good practice and costs nothing, so the same credit line renders for
// both sources.

import { downloadImage } from './poe.mjs';

const UTM = 'utm_source=mindtivate&utm_medium=referral';

function withUtm(url) {
  return `${url}${url.includes('?') ? '&' : '?'}${UTM}`;
}

// Random pick among the top `pool` results rather than always the #1
// match — the whole point of adding stock photos is more variety across
// topically-similar articles, so always grabbing the top search hit
// would just trade one kind of repetition for another.
function pickRandom(list, pool = 10) {
  const candidates = list.slice(0, pool);
  return candidates[Math.floor(Math.random() * candidates.length)];
}

async function searchPexels(query) {
  const apiKey = process.env.PEXELS_API_KEY;
  if (!apiKey) return null;

  const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=15&orientation=landscape`;
  const res = await fetch(url, { headers: { Authorization: apiKey } });
  if (!res.ok) throw new Error(`Pexels API error: ${res.status} ${await res.text()}`);

  const data = await res.json();
  const photo = pickRandom(data.photos ?? []);
  if (!photo) return null;

  return {
    downloadUrl: photo.src?.large2x || photo.src?.large || photo.src?.original,
    photographer: photo.photographer,
    photographerUrl: photo.photographer_url,
    sourceUrl: photo.url,
    sourceName: 'Pexels',
  };
}

async function searchUnsplash(query) {
  const accessKey = process.env.UNSPLASH_ACCESS_KEY;
  if (!accessKey) return null;

  const url = `https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&per_page=15&orientation=landscape`;
  const res = await fetch(url, { headers: { Authorization: `Client-ID ${accessKey}` } });
  if (!res.ok) throw new Error(`Unsplash API error: ${res.status} ${await res.text()}`);

  const data = await res.json();
  const photo = pickRandom(data.results ?? []);
  if (!photo) return null;

  return {
    downloadUrl: photo.urls?.regular || photo.urls?.full,
    downloadLocation: photo.links?.download_location, // for the required tracking ping
    photographer: photo.user?.name,
    photographerUrl: photo.user?.links?.html ? withUtm(photo.user.links.html) : undefined,
    sourceUrl: photo.links?.html ? withUtm(photo.links.html) : undefined,
    sourceName: 'Unsplash',
  };
}

// Best-effort, fire-and-forget per Unsplash's guidelines — a failure here
// doesn't affect the article at all, just Unsplash's own download stats.
async function pingUnsplashDownload(downloadLocation) {
  if (!downloadLocation) return;
  const accessKey = process.env.UNSPLASH_ACCESS_KEY;
  try {
    const sep = downloadLocation.includes('?') ? '&' : '?';
    await fetch(`${downloadLocation}${sep}client_id=${accessKey}`);
  } catch {
    // analytics ping only — never worth failing the run over
  }
}

/**
 * Searches for a real, licensed stock photo matching `query`, downloads
 * it, and returns { buffer, ext, photographer, photographerUrl,
 * sourceUrl, sourceName }, or null if neither source is configured, has
 * no match, or the download fails. Randomly tries Pexels or Unsplash
 * first (whichever are actually configured — a single configured source
 * is used directly); if the first pick has no results, falls back to the
 * other configured source once before giving up.
 */
export async function findStockPhoto(query) {
  const searchers = [
    { name: 'Pexels', fn: searchPexels },
    { name: 'Unsplash', fn: searchUnsplash },
  ].filter(({ name }) => (name === 'Pexels' ? process.env.PEXELS_API_KEY : process.env.UNSPLASH_ACCESS_KEY));

  if (searchers.length === 0) return null;
  if (searchers.length === 2 && Math.random() < 0.5) searchers.reverse();

  for (const { fn } of searchers) {
    let result;
    try {
      result = await fn(query);
    } catch (err) {
      console.warn(`  stock photo search failed (${err.message}), trying next source if any...`);
      continue;
    }
    if (!result?.downloadUrl) continue;

    try {
      const { buffer, ext } = await downloadImage(result.downloadUrl);
      if (result.downloadLocation) await pingUnsplashDownload(result.downloadLocation);
      return {
        buffer,
        ext,
        photographer: result.photographer,
        photographerUrl: result.photographerUrl,
        sourceUrl: result.sourceUrl,
        sourceName: result.sourceName,
      };
    } catch (err) {
      console.warn(`  stock photo download failed (${err.message}), trying next source if any...`);
    }
  }

  return null;
}

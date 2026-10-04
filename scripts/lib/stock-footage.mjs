// Real, licensed stock-footage sourcing for YouTube Shorts B-roll (Pexels
// + Pixabay), used by scripts/pipeline/12-youtube-short.mjs -- same
// approach and PEXELS_API_KEY env var as scripts/lib/stockphotos.mjs
// (article hero photos), just the video search endpoints instead of the
// photo ones. Get keys at https://www.pexels.com/api/ (instant, same key
// works for both photos and videos) and https://pixabay.com/api/docs/
// (instant). Every function here is non-fatal by design (returns null
// rather than throwing) -- a sourcing miss for one beat shouldn't fail
// the whole video; the caller decides how to handle a null (skip the
// beat's visual variety, retry with a broader query, etc.).
//
// Both platforms' free licenses permit commercial use without required
// attribution, but neither permits implying endorsement by anyone shown,
// and a clip showing an identifiable person can read as "this is that
// person's real story" for sensitive topics (postpartum, grief,
// disability, menopause) -- see docs/COMPLIANCE.md's YouTube section.
// Callers should bias search queries toward settings/objects/hands
// rather than faces for those categories.

const UTM = 'utm_source=mindtivate&utm_medium=video';

function withUtm(url) {
  return `${url}${url.includes('?') ? '&' : '?'}${UTM}`;
}

// Same reasoning as stockphotos.mjs's pickRandom -- always grabbing the
// #1 match would mean every article whose B-roll keywords overlap (e.g.
// "kitchen counter" shows up across several Food/Beauty articles) ends
// up reusing the exact same clip, which reads as low-effort/repetitive
// across a channel in a way it wouldn't for a single one-off hero image.
// `exclude` filters out URLs already used elsewhere in the same video
// (so beat 1 and beat 3 don't pick an identical clip).
function pickRandom(list, { pool = 10, exclude = new Set(), urlOf }) {
  const candidates = list.slice(0, pool).filter((item) => !exclude.has(urlOf(item)));
  if (candidates.length === 0) return null;
  return candidates[Math.floor(Math.random() * candidates.length)];
}

// Picks the best video_files/size entry for a 9:16 render: prefers an
// already-portrait (height > width) file at the highest resolution
// available, falling back to the highest-resolution landscape file if no
// portrait option exists (the caller's ffmpeg assembly center-crops
// landscape source to 9:16 as a universal fallback regardless of source).
function pickBestFile(files, { widthOf, heightOf }) {
  if (!files.length) return null;
  const portrait = files.filter((f) => heightOf(f) > widthOf(f));
  const pool = portrait.length ? portrait : files;
  return pool.reduce((best, f) => (!best || widthOf(f) * heightOf(f) > widthOf(best) * heightOf(best) ? f : best), null);
}

async function searchPexels(query, { exclude }) {
  const apiKey = process.env.PEXELS_API_KEY;
  if (!apiKey) return null;

  const url = `https://api.pexels.com/videos/search?query=${encodeURIComponent(query)}&per_page=15&orientation=portrait`;
  const res = await fetch(url, { headers: { Authorization: apiKey } });
  if (!res.ok) throw new Error(`Pexels Video API error: ${res.status} ${await res.text()}`);

  const data = await res.json();
  const video = pickRandom(data.videos ?? [], { exclude, urlOf: (v) => v.url });
  if (!video) return null;

  const file = pickBestFile(video.video_files ?? [], { widthOf: (f) => f.width, heightOf: (f) => f.height });
  if (!file?.link) return null;

  return {
    downloadUrl: file.link,
    width: file.width,
    height: file.height,
    duration: video.duration,
    attribution: video.user?.name,
    attributionUrl: video.user?.url ? withUtm(video.user.url) : undefined,
    sourceUrl: withUtm(video.url),
    sourceName: 'Pexels',
  };
}

async function searchPixabay(query, { exclude }) {
  const apiKey = process.env.PIXABAY_API_KEY;
  if (!apiKey) return null;

  const url = `https://pixabay.com/api/videos/?key=${apiKey}&q=${encodeURIComponent(query)}&per_page=15`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Pixabay Video API error: ${res.status} ${await res.text()}`);

  const data = await res.json();
  const hit = pickRandom(data.hits ?? [], { exclude, urlOf: (h) => h.pageURL });
  if (!hit) return null;

  const sizes = Object.values(hit.videos ?? {}).filter((v) => v?.url);
  const file = pickBestFile(sizes, { widthOf: (f) => f.width, heightOf: (f) => f.height });
  if (!file?.url) return null;

  return {
    downloadUrl: file.url,
    width: file.width,
    height: file.height,
    duration: hit.duration,
    attribution: hit.user,
    attributionUrl: hit.user_id ? withUtm(`https://pixabay.com/users/${hit.user_id}/`) : undefined,
    sourceUrl: withUtm(hit.pageURL),
    sourceName: 'Pixabay',
  };
}

/**
 * Searches for a real, licensed stock video clip matching `query`,
 * downloads it, and returns { buffer, ext: 'mp4', width, height,
 * duration, attribution, attributionUrl, sourceUrl, sourceName }, or
 * null if neither source is configured, has no match (after excluding
 * `excludeUrls`), or the download fails. Randomly tries Pexels or
 * Pixabay first (whichever are actually configured); if the first pick
 * has no results, falls back to the other configured source once before
 * giving up -- same two-source fallback shape as
 * stockphotos.mjs's findStockPhoto.
 */
export async function findStockVideo(query, { excludeUrls = new Set() } = {}) {
  const searchers = [
    { name: 'Pexels', fn: searchPexels },
    { name: 'Pixabay', fn: searchPixabay },
  ].filter(({ name }) => (name === 'Pexels' ? process.env.PEXELS_API_KEY : process.env.PIXABAY_API_KEY));

  if (searchers.length === 0) return null;
  if (searchers.length === 2 && Math.random() < 0.5) searchers.reverse();

  for (const { fn } of searchers) {
    let result;
    try {
      result = await fn(query, { exclude: excludeUrls });
    } catch (err) {
      console.warn(`  stock video search failed (${err.message}), trying next source if any...`);
      continue;
    }
    if (!result?.downloadUrl) continue;

    try {
      const res = await fetch(result.downloadUrl);
      if (!res.ok) throw new Error(`download failed: ${res.status}`);
      const buffer = Buffer.from(await res.arrayBuffer());
      return { buffer, ext: 'mp4', ...result };
    } catch (err) {
      console.warn(`  stock video download failed (${err.message}), trying next source if any...`);
    }
  }

  return null;
}

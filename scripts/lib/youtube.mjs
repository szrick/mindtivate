// YouTube Data API v3 client -- OAuth2 refresh-token auth + the
// resumable upload protocol, used by scripts/pipeline/12-youtube-short.mjs.
// No googleapis SDK dependency, matching this project's raw-fetch
// convention for every other platform client (poe.mjs, buffer.mjs,
// pinterest.mjs, sender.mjs).
//
// Needs a one-time, by-hand OAuth authorization against the real YouTube
// channel -- there's no way to script that first consent step (same as
// Buffer's initial Pinterest channel linking). Run
// scripts/pipeline/youtube-oauth-setup.mjs locally once to get a refresh
// token; see docs/SETUP.md's YouTube section.
//
// Every upload lands as status: private (see uploadVideo's default) --
// the human-review gate here is a private YouTube upload a person
// actually watches on youtube.com before publishVideo() ever runs, the
// same "draft, then a human approves, then it goes out" shape as every
// other channel in this pipeline (see docs/COMPLIANCE.md).
//
// COPPA requires every video to declare made-for-kids status at upload
// time -- selfDeclaredMadeForKids: false below, since this is general
// adult wellness content, not child-directed.

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const UPLOAD_URL = 'https://www.googleapis.com/upload/youtube/v3/videos';
const API_URL = 'https://www.googleapis.com/youtube/v3/videos';
const THUMBNAIL_UPLOAD_URL = 'https://www.googleapis.com/upload/youtube/v3/thumbnails/set';

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

/**
 * Exchanges the long-lived refresh token (YOUTUBE_REFRESH_TOKEN) for a
 * short-lived access token. Called once per script run -- nothing in
 * this pipeline runs long enough for a single access token (1 hour) to
 * expire mid-run, so there's no caching/refresh-on-expiry logic here.
 */
export async function getAccessToken({ clientId, clientSecret, refreshToken } = {}) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId || requireEnv('YOUTUBE_CLIENT_ID'),
      client_secret: clientSecret || requireEnv('YOUTUBE_CLIENT_SECRET'),
      refresh_token: refreshToken || requireEnv('YOUTUBE_REFRESH_TOKEN'),
      grant_type: 'refresh_token',
    }),
  });

  if (!res.ok) {
    throw new Error(`YouTube OAuth token refresh failed: ${res.status} ${await res.text()}`);
  }

  const data = await res.json();
  return data.access_token;
}

/**
 * Uploads `buffer` (an mp4) via the two-phase resumable upload protocol
 * (initiate -> PUT the full body in one request, which the protocol
 * allows for anything that comfortably fits in memory -- a 30-45s
 * Short's mp4 is a few MB to a few tens of MB, nowhere near large enough
 * to need actual chunked/resumable retry logic) and returns the created
 * video resource (including its id). Always uploads as
 * status.privacyStatus: 'private' regardless of what's eventually
 * intended -- see this file's header comment for why. categoryId "26" is
 * "Howto & Style"; see
 * https://developers.google.com/youtube/v3/docs/videoCategories/list for
 * the full list if a different one fits better.
 */
export async function uploadVideo({ buffer, title, description, tags = [], categoryId = '26', accessToken }) {
  const token = accessToken || (await getAccessToken());

  const metadata = {
    snippet: { title, description, tags, categoryId },
    status: { privacyStatus: 'private', selfDeclaredMadeForKids: false },
  };

  const initRes = await fetch(`${UPLOAD_URL}?uploadType=resumable&part=snippet,status`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Length': String(buffer.length),
      'X-Upload-Content-Type': 'video/mp4',
    },
    body: JSON.stringify(metadata),
  });

  if (!initRes.ok) {
    throw new Error(`YouTube upload session init failed: ${initRes.status} ${await initRes.text()}`);
  }

  const sessionUrl = initRes.headers.get('location');
  if (!sessionUrl) throw new Error('YouTube upload session init did not return a Location header.');

  const uploadRes = await fetch(sessionUrl, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'video/mp4',
      'Content-Length': String(buffer.length),
    },
    body: buffer,
  });

  if (!uploadRes.ok) {
    throw new Error(`YouTube video upload failed: ${uploadRes.status} ${await uploadRes.text()}`);
  }

  return uploadRes.json();
}

/**
 * Flips an already-uploaded video's privacyStatus from 'private' to
 * 'public' -- the "send" half of the draft/approve/send pattern, called
 * only for a draft a human has already marked "approved": true (see
 * youtube-auto-publish.yml, mirroring pinterest-auto-send.yml).
 */
export async function publishVideo(videoId, { accessToken } = {}) {
  const token = accessToken || (await getAccessToken());

  const res = await fetch(`${API_URL}?part=status`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      id: videoId,
      status: { privacyStatus: 'public', selfDeclaredMadeForKids: false },
    }),
  });

  if (!res.ok) {
    throw new Error(`YouTube publish (privacyStatus -> public) failed: ${res.status} ${await res.text()}`);
  }

  return res.json();
}

/**
 * Fetches a video's current snippet/status -- used as a diagnostic to
 * check what's actually registered server-side (snippet.thumbnails, in
 * particular) independent of whatever Studio's UI happens to be caching
 * at the moment someone looks. Deliberately excludes the
 * processingDetails/fileDetails/suggestions parts -- those are
 * restricted to a content-owner/CMS scope even under youtube.force-ssl
 * and return ACCESS_TOKEN_SCOPE_INSUFFICIENT otherwise, confirmed live
 * when this function first shipped with processingDetails included.
 */
export async function getVideo(videoId, { accessToken } = {}) {
  const token = accessToken || (await getAccessToken());

  const res = await fetch(`${API_URL}?part=snippet,status&id=${encodeURIComponent(videoId)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    throw new Error(`YouTube video lookup failed: ${res.status} ${await res.text()}`);
  }

  const data = await res.json();
  if (!data.items?.length) throw new Error(`No video found for id ${videoId}`);
  return data.items[0];
}

/**
 * Uploads `buffer` as the custom thumbnail for an already-uploaded video.
 * Unlike videos.insert/update (youtube.upload scope is enough), this
 * endpoint requires the broader youtube.force-ssl scope -- a
 * YOUTUBE_REFRESH_TOKEN issued only for youtube.upload will fail here
 * with an insufficient-scope error; see docs/SETUP.md for re-running
 * youtube-oauth-setup.mjs to get a token with both. Also requires the
 * channel to have "Additional features" phone verification enabled on
 * youtube.com/verify -- an unverified channel gets a clear API error
 * back here, not a silent no-op.
 */
export async function setThumbnail(videoId, buffer, { mimeType = 'image/png', accessToken } = {}) {
  const token = accessToken || (await getAccessToken());

  const res = await fetch(`${THUMBNAIL_UPLOAD_URL}?videoId=${encodeURIComponent(videoId)}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': mimeType,
      'Content-Length': String(buffer.length),
    },
    body: buffer,
  });

  if (!res.ok) {
    throw new Error(`YouTube thumbnail upload failed: ${res.status} ${await res.text()}`);
  }

  return res.json();
}

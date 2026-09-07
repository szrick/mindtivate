// Minimal Pinterest API v5 client (no dependency). Requires an app with
// "pins:write" and "boards:read" scopes — see docs/SETUP.md.

import { readFileSync } from 'node:fs';

const API_BASE = 'https://api.pinterest.com/v5';
const BOARD_MAP_PATH = new URL('./pinterest-boards.json', import.meta.url);

// image_base64 lets a pin ship in one call with no image hosting step —
// the alternative, image_url, requires the image to already be reachable
// at a public URL, which for a generated (not-yet-deployed) pin image
// would mean waiting on a site deploy first. Both are real Pinterest API
// options; this picks whichever the caller actually provided.
export async function createPin({ title, description, link, imageUrl, imageBase64, imageContentType, boardId, accessToken }) {
  const token = accessToken || process.env.PINTEREST_ACCESS_TOKEN;
  const board = boardId || process.env.PINTEREST_BOARD_ID;
  if (!token) throw new Error('Missing PINTEREST_ACCESS_TOKEN');
  if (!board) throw new Error('Missing PINTEREST_BOARD_ID (and no category board configured — see pinterest-boards.json)');

  const media_source = imageBase64
    ? { source_type: 'image_base64', content_type: imageContentType || 'image/png', data: imageBase64 }
    : { source_type: 'image_url', url: imageUrl };

  const res = await fetch(`${API_BASE}/pins`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ board_id: board, title, description, link, media_source }),
  });

  if (!res.ok) {
    throw new Error(`Pinterest createPin failed: ${res.status} ${await res.text()}`);
  }

  return res.json();
}

// Category -> board ID, read fresh each call rather than cached at import
// time (this file's data changes independently of any running process —
// see pinterest-boards.json's own comment). Falls back to
// PINTEREST_BOARD_ID (a single catch-all board) when a category has no
// board configured yet, so pin creation keeps working while boards are
// being set up one at a time.
export function resolveBoardId(category) {
  try {
    const map = JSON.parse(readFileSync(BOARD_MAP_PATH, 'utf8'));
    const boardId = map[category];
    if (boardId) return boardId;
  } catch {
    // pinterest-boards.json missing or malformed — fall through to the env var
  }
  return process.env.PINTEREST_BOARD_ID || null;
}

// Mints a fresh access token from a refresh token, so unattended/CI use
// (pinterest-auto-send.yml) doesn't depend on manually regenerating
// PINTEREST_ACCESS_TOKEN every 30 days (Pinterest's access-token
// lifetime). Requires PINTEREST_APP_ID, PINTEREST_APP_SECRET, and
// PINTEREST_REFRESH_TOKEN (see docs/SETUP.md for how to get all three) —
// returns null (not an error) when any is missing, so a caller can just
// fall back to a plain PINTEREST_ACCESS_TOKEN, same as before this
// existed.
//
// Pinterest's refresh token is the "continuous" kind (refreshable
// indefinitely, not single-use) -- reusing it is expected to keep
// working as long as it's used at least once within its ~60-day window,
// rather than being invalidated on first use. If a response ever does
// come back with a *different* refresh_token than the one sent, that's
// logged as a warning (never the token value itself) rather than
// silently swapped in -- this deliberately does not attempt to rewrite
// the PINTEREST_REFRESH_TOKEN secret on its own; if the old one stops
// working, a human needs to redo the OAuth flow and update it by hand.
export async function refreshAccessToken({ appId, appSecret, refreshToken } = {}) {
  const id = appId || process.env.PINTEREST_APP_ID;
  const secret = appSecret || process.env.PINTEREST_APP_SECRET;
  const refresh = refreshToken || process.env.PINTEREST_REFRESH_TOKEN;
  if (!id || !secret || !refresh) return null;

  const basicAuth = Buffer.from(`${id}:${secret}`).toString('base64');
  const res = await fetch(`${API_BASE}/oauth/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basicAuth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refresh }),
  });

  if (!res.ok) {
    throw new Error(`Pinterest token refresh failed: ${res.status} ${await res.text()}`);
  }

  const data = await res.json();
  if (data.refresh_token && data.refresh_token !== refresh) {
    console.warn(
      'Pinterest returned a new refresh_token on this refresh -- update the PINTEREST_REFRESH_TOKEN secret with it if the current one ever stops working (not logging the value itself).',
    );
  }
  return data.access_token;
}

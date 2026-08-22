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

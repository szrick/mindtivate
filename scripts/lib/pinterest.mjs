// Minimal Pinterest API v5 client (no dependency). Requires an app with
// "pins:write" and "boards:read" scopes — see docs/SETUP.md.

const API_BASE = 'https://api.pinterest.com/v5';

export async function createPin({ title, description, link, imageUrl, boardId, accessToken }) {
  const token = accessToken || process.env.PINTEREST_ACCESS_TOKEN;
  const board = boardId || process.env.PINTEREST_BOARD_ID;
  if (!token) throw new Error('Missing PINTEREST_ACCESS_TOKEN');
  if (!board) throw new Error('Missing PINTEREST_BOARD_ID');

  const res = await fetch(`${API_BASE}/pins`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      board_id: board,
      title,
      description,
      link,
      media_source: {
        source_type: 'image_url',
        url: imageUrl,
      },
    }),
  });

  if (!res.ok) {
    throw new Error(`Pinterest createPin failed: ${res.status} ${await res.text()}`);
  }

  return res.json();
}

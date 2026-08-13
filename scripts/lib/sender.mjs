// Minimal Sender.net API client (no dependency). Used only as a fallback
// for a one-off "new article" campaign trigger; the primary automation path
// is the RSS-to-email automation described in docs/CONTENT_PIPELINE.md,
// which needs no API call at all.

const API_BASE = 'https://api.sender.net/v2';

export async function addSubscriberToGroup({ email, groupId, apiToken }) {
  const token = apiToken || process.env.SENDER_API_TOKEN;
  const group = groupId || process.env.SENDER_GROUP_ID;
  if (!token) throw new Error('Missing SENDER_API_TOKEN');
  if (!group) throw new Error('Missing SENDER_GROUP_ID');

  const res = await fetch(`${API_BASE}/subscribers`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, groups: [group] }),
  });

  if (!res.ok) {
    throw new Error(`Sender addSubscriber failed: ${res.status} ${await res.text()}`);
  }

  return res.json();
}

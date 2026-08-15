// Poe API client (OpenAI-compatible chat completions endpoint), used for
// stage 2 (product-match) instead of the direct Anthropic client in
// scripts/lib/claude.mjs. Get a key at https://poe.com/api_key.

const API_URL = 'https://api.poe.com/v1/chat/completions';

export async function askPoe({ system, prompt, maxTokens = 4096, temperature = 0.6 }) {
  const apiKey = process.env.POE_API_KEY;
  if (!apiKey) throw new Error('Missing required env var: POE_API_KEY');
  const model = process.env.POE_MODEL || 'Claude-Sonnet-4.5';

  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      temperature,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: prompt },
      ],
    }),
  });

  if (!res.ok) {
    throw new Error(`Poe API error: ${res.status} ${await res.text()}`);
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? '';
}

/**
 * Ask Poe for strict JSON and parse it. Throws if the response isn't
 * valid JSON (callers should retry or fail loudly rather than publish
 * malformed content).
 */
export async function askPoeForJson(args) {
  const raw = await askPoe(args);
  const cleaned = raw.trim().replace(/^```json\s*/i, '').replace(/```$/, '');
  return JSON.parse(cleaned);
}

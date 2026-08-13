// Minimal Anthropic Messages API client (no SDK dependency).

const API_URL = 'https://api.anthropic.com/v1/messages';

export async function askClaude({ system, prompt, maxTokens = 4096, temperature = 0.6 }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('Missing required env var: ANTHROPIC_API_KEY');
  const model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';

  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      temperature,
      system,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!res.ok) {
    throw new Error(`Anthropic API error: ${res.status} ${await res.text()}`);
  }

  const data = await res.json();
  return data.content.map((block) => (block.type === 'text' ? block.text : '')).join('');
}

/**
 * Ask Claude for strict JSON and parse it. Throws if the response isn't
 * valid JSON (callers should retry or fail loudly rather than publish
 * malformed content).
 */
export async function askClaudeForJson(args) {
  const raw = await askClaude(args);
  const cleaned = raw.trim().replace(/^```json\s*/i, '').replace(/```$/, '');
  return JSON.parse(cleaned);
}

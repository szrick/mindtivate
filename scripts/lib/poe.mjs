// Poe API client (OpenAI-compatible chat completions endpoint), used for
// stages 2 and 3 instead of the direct Anthropic client in
// scripts/lib/claude.mjs. Get a key at https://poe.com/api_key.
//
// Bot handles (the "model" field) are whatever's available on your Poe
// account and can change — POE_MODEL / POE_IMAGE_MODEL / POE_SEARCH_MODEL
// let you point at the right one without touching this file.

const API_URL = 'https://api.poe.com/v1/chat/completions';

function requireApiKey() {
  const apiKey = process.env.POE_API_KEY;
  if (!apiKey) throw new Error('Missing required env var: POE_API_KEY');
  return apiKey;
}

export async function askPoe({ system, prompt, maxTokens = 4096, temperature = 0.6, model }) {
  const apiKey = requireApiKey();
  const resolvedModel = model || process.env.POE_MODEL || 'Claude-Sonnet-4.5';

  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: resolvedModel,
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

const SEARCH_SYSTEM_PROMPT = `You are a research assistant with live web access. Given a topic, find a
short list of currently real, reputable, authoritative sources — .gov/.edu
sites, major medical or scientific bodies (NIH, CDC, Mayo Clinic, ACSM,
NASM, etc.), or peer-reviewed research — relevant to the topic. Only
include URLs you have actually found and can verify are real and
reachable right now; never invent or guess a URL. If you can't find
genuinely reliable sources, return an empty list rather than a weak one.

Respond with strict JSON only, no prose outside the JSON:
{"sources": [{"title": string, "url": string, "note": string}]}`;

/**
 * Uses a search-capable Poe bot (POE_SEARCH_MODEL, e.g. a web-search bot)
 * to find real authority sources for a topic. Returns { sources: [] } on
 * anything that isn't clean JSON, rather than throwing — source search is
 * a nice-to-have for citations, not a hard requirement for drafting.
 */
export async function searchAuthoritySources({ topic, count = 4 }) {
  const model = process.env.POE_SEARCH_MODEL || 'Web-Search';
  const prompt = `Topic: ${topic}\n\nFind up to ${count} authoritative sources a health/fitness article could cite for this topic.`;
  try {
    const result = await askPoeForJson({ system: SEARCH_SYSTEM_PROMPT, prompt, maxTokens: 800, model });
    return { sources: Array.isArray(result?.sources) ? result.sources.slice(0, count) : [] };
  } catch (err) {
    return { sources: [], error: err.message };
  }
}

const IMAGE_MARKDOWN_RE = /!\[[^\]]*\]\((https?:\/\/[^\s)]+)\)/;
const BARE_IMAGE_URL_RE = /(https?:\/\/\S+\.(?:png|jpe?g|webp))/i;

/**
 * Generates an image via a Poe image-gen bot (POE_IMAGE_MODEL) and returns
 * the downloaded bytes. Image-gen bots on Poe return the image as an
 * attachment or a markdown image link in the chat response rather than
 * through a dedicated images/generations endpoint, so this parses both
 * shapes defensively and throws a descriptive error (including a slice of
 * the raw response) if neither is found — that's usually a sign
 * POE_IMAGE_MODEL doesn't match a bot available on your account.
 */
export async function generatePoeImage({ prompt, model }) {
  const apiKey = requireApiKey();
  const imageModel = model || process.env.POE_IMAGE_MODEL || 'FLUX-pro-1.1';

  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: imageModel,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!res.ok) {
    throw new Error(`Poe image API error: ${res.status} ${await res.text()}`);
  }

  const data = await res.json();
  const message = data.choices?.[0]?.message ?? {};
  const attachmentUrl = Array.isArray(message.attachments)
    ? message.attachments.find((a) => a?.url)?.url
    : undefined;
  const imageUrl = attachmentUrl || message.content?.match(IMAGE_MARKDOWN_RE)?.[1] || message.content?.match(BARE_IMAGE_URL_RE)?.[1];

  if (!imageUrl) {
    throw new Error(
      `Poe image bot "${imageModel}" did not return a recognizable image URL. Raw response: ${JSON.stringify(data).slice(0, 500)}`
    );
  }

  const imgRes = await fetch(imageUrl);
  if (!imgRes.ok) throw new Error(`Failed to download generated image from ${imageUrl}: ${imgRes.status}`);
  const contentType = imgRes.headers.get('content-type') || 'image/png';
  const buffer = Buffer.from(await imgRes.arrayBuffer());
  const ext = contentType.includes('webp') ? 'webp' : contentType.includes('jpeg') ? 'jpg' : 'png';
  return { buffer, ext };
}

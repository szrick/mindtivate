// Poe API client (OpenAI-compatible chat completions endpoint) — the
// only LLM credential this pipeline needs; every drafting stage (2, 3,
// 5, 6, 7, 8) goes through here rather than a direct provider client.
// Get a key at https://poe.com/api_key.
//
// Bot handles (the "model" field) are whatever's available on your Poe
// account and can change — POE_MODEL / POE_IMAGE_MODEL / POE_SEARCH_MODEL
// let you point at the right one without touching this file.

import sharp from 'sharp';

const API_URL = 'https://api.poe.com/v1/chat/completions';

function requireApiKey() {
  const apiKey = process.env.POE_API_KEY;
  if (!apiKey) throw new Error('Missing required env var: POE_API_KEY');
  return apiKey;
}

// `images`, when given, is [{ base64, mimeType }] — sent alongside `prompt`
// as OpenAI-style image_url content parts. Only vision-capable Poe bots
// (the default POE_MODEL, Claude-Sonnet-4.5, is one) can actually see
// them; a non-vision bot will just ignore the image parts or error, so
// callers that need vision should pass an explicit vision-capable
// `model` if they've pointed POE_MODEL elsewhere.
export async function askPoe({ system, prompt, maxTokens = 4096, temperature = 0.6, model, images }) {
  const apiKey = requireApiKey();
  const resolvedModel = model || process.env.POE_MODEL || 'Claude-Sonnet-4.5';

  const userContent = images?.length
    ? [
        { type: 'text', text: prompt },
        ...images.map((img) => ({
          type: 'image_url',
          image_url: { url: `data:${img.mimeType};base64,${img.base64}` },
        })),
      ]
    : prompt;

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
        { role: 'user', content: userContent },
      ],
    }),
  });

  if (!res.ok) {
    throw new Error(`Poe API error: ${res.status} ${await res.text()}`);
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? '';
}

// Finds the end of the first complete JSON object/array in `str`
// (starting at its first `{` or `[`) by tracking brace/bracket depth,
// ignoring anything inside string literals (so a `}` in prose text
// doesn't miscount). Needed because a "strict JSON only" instruction
// doesn't always stop a model from adding a trailing aside after the
// JSON ("...}\n\nLet me know if you'd like any changes!") -- a real,
// recurring failure mode, not hypothetical: this bit an actual
// weekly-pinterest-pins.yml run (SyntaxError: Unexpected non-whitespace
// character after JSON at position 1077). Returns the trimmed
// leading-brace-to-matching-close slice, or the original string
// untouched if it can't find a balanced value (JSON.parse's own error
// below is clear enough at that point).
function extractFirstJsonValue(str) {
  const start = str.search(/[{[]/);
  if (start === -1) return str;
  const open = str[start];
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let inString = false;
  let escapeNext = false;
  for (let i = start; i < str.length; i++) {
    const ch = str[i];
    if (escapeNext) {
      escapeNext = false;
      continue;
    }
    if (ch === '\\') {
      escapeNext = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return str.slice(start, i + 1);
    }
  }
  return str.slice(start);
}

/**
 * Ask Poe for strict JSON and parse it. Throws if the response isn't
 * valid JSON (callers should retry or fail loudly rather than publish
 * malformed content) -- the error message includes a slice of the raw
 * response so a real malformed-JSON case is actually debuggable, not
 * just "Unexpected token".
 */
export async function askPoeForJson(args) {
  const raw = await askPoe(args);
  const fenced = raw.trim().replace(/^```json\s*/i, '').replace(/```$/, '').trim();
  const jsonOnly = extractFirstJsonValue(fenced);
  try {
    return JSON.parse(jsonOnly);
  } catch (err) {
    throw new Error(`Poe did not return valid JSON (${err.message}). Raw response (first 500 chars): ${raw.slice(0, 500)}`);
  }
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

// Shared with scripts/lib/stockphotos.mjs (Pexels/Unsplash hero-image
// sourcing) so both real-photo paths download the same way. Poe's
// image-gen bots and Pexels/Unsplash all serve PNG or JPEG by default,
// never WebP themselves, so every downloaded image is transcoded to
// WebP here -- smaller file size than PNG/JPEG at equivalent visual
// quality, for faster page loads. sharp is already a transitive
// dependency of Astro's own image service, so this adds no new install;
// it's declared directly in package.json since this pipeline relies on
// it regardless of what Astro happens to bundle.
export async function downloadImage(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download image from ${url}: ${res.status}`);
  const original = Buffer.from(await res.arrayBuffer());
  const buffer = await sharp(original).webp({ quality: 82 }).toBuffer();
  return { buffer, ext: 'webp' };
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
 *
 * Used for article hero illustrations only — see findAmazonProductImage
 * below for product images, which are sourced from real listings instead
 * of generated.
 */
export async function generatePoeImage({ prompt, model }) {
  const apiKey = requireApiKey();
  const imageModel = model || process.env.POE_IMAGE_MODEL || 'GPT-Image-1';

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
    const body = await res.text();
    const hint =
      res.status >= 500
        ? ` (a 5xx here usually means POE_IMAGE_MODEL="${imageModel}" isn't a bot handle your Poe account can actually reach via the chat-completions API — check the exact handle at https://poe.com and via /explore, not a bug in the request itself)`
        : '';
    throw new Error(`Poe image API error: ${res.status} ${body}${hint}`);
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

  return downloadImage(imageUrl);
}

const AMAZON_SEARCH_SYSTEM_PROMPT = `You have live web search access. Search amazon.com ONLY (no other retailer)
for a real, currently listed product matching the description given. This
is for a human editor to manually review before ever applying to Amazon's
affiliate program — accuracy matters more than finding *something*. Only
report a product you actually found in amazon.com search results; never
fabricate or guess a listing, image URL, or product page URL.

Respond with strict JSON only, no prose outside the JSON:
{"found": boolean, "matchedTitle": string | null, "productImageUrl": string | null, "productPageUrl": string | null}
Set found to false and the other fields to null if you cannot confirm a
genuine, specific match.`;

/**
 * Searches amazon.com (via POE_SEARCH_MODEL) for a real product matching
 * `query` and downloads its listing image. Returns { found: false } if no
 * confident match was found, or { found: false, error } if the search
 * itself failed — both non-fatal for the caller. The image this returns
 * is a real Amazon listing photo, not AI-generated, but it's still
 * unverified: the caller is responsible for flagging it for human review
 * before publishing (see COMPLIANCE.md on rehosting marketplace images).
 */
export async function findAmazonProductImage({ query }) {
  const model = process.env.POE_SEARCH_MODEL || 'Web-Search';
  const prompt = `Product to find on amazon.com: ${query}`;
  let result;
  try {
    result = await askPoeForJson({ system: AMAZON_SEARCH_SYSTEM_PROMPT, prompt, maxTokens: 500, model });
  } catch (err) {
    return { found: false, error: err.message };
  }
  if (!result?.found || !result.productImageUrl) return { found: false };

  try {
    const { buffer, ext } = await downloadImage(result.productImageUrl);
    return {
      found: true,
      buffer,
      ext,
      matchedTitle: result.matchedTitle ?? null,
      productPageUrl: result.productPageUrl ?? null,
    };
  } catch (err) {
    return { found: false, error: err.message };
  }
}

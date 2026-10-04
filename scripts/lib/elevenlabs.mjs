// ElevenLabs text-to-speech client -- used by
// scripts/pipeline/12-youtube-short.mjs for the Short's voiceover. Get a
// key at https://elevenlabs.io (the API key is under Settings → API
// Keys); pick a voice from https://elevenlabs.io/app/voice-library and
// copy its voice ID into ELEVENLABS_VOICE_ID (see docs/SETUP.md).
//
// Uses the "with-timestamps" endpoint rather than the plain
// text-to-speech one specifically for caption sync: a Short's captions
// need to appear in time with the spoken word, and the only reliable way
// to get that without a separate (error-prone) forced-alignment step is
// to ask ElevenLabs for character-level timing alongside the audio in
// the same call.

const API_BASE = 'https://api.elevenlabs.io/v1';

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

// ElevenLabs returns per-*character* timing, not per-word -- captions
// render word-by-word (see buildCaptionTrack in
// scripts/pipeline/12-youtube-short.mjs), so this groups consecutive
// non-whitespace characters into words, each word spanning its first
// character's start time to its last character's end time. Whitespace
// characters (which still get their own timing entries) are skipped,
// not treated as part of either neighboring word.
function charsToWordTimings(characters, startTimes, endTimes) {
  const words = [];
  let current = null;

  for (let i = 0; i < characters.length; i++) {
    const ch = characters[i];
    if (/^\s$/.test(ch)) {
      current = null;
      continue;
    }
    if (!current) {
      current = { word: ch, start: startTimes[i], end: endTimes[i] };
      words.push(current);
    } else {
      current.word += ch;
      current.end = endTimes[i];
    }
  }

  return words;
}

/**
 * Synthesizes `text` as speech and returns { buffer (mp3), words: [{
 * word, start, end }] } with word-level timestamps (in seconds) derived
 * from ElevenLabs' character-level alignment data. `voiceId`/`modelId`
 * default to the ELEVENLABS_VOICE_ID/ELEVENLABS_MODEL_ID env vars so a
 * caller doesn't have to thread them through from every call site --
 * ELEVENLABS_MODEL_ID defaults to 'eleven_turbo_v2_5' (good quality,
 * lower latency/cost than the non-turbo models, and multilingual-capable
 * should an article ever need it) if unset.
 */
export async function synthesizeSpeech({ text, voiceId, modelId, apiKey } = {}) {
  const key = apiKey || requireEnv('ELEVENLABS_API_KEY');
  const voice = voiceId || requireEnv('ELEVENLABS_VOICE_ID');
  const model = modelId || process.env.ELEVENLABS_MODEL_ID || 'eleven_turbo_v2_5';

  const res = await fetch(`${API_BASE}/text-to-speech/${voice}/with-timestamps`, {
    method: 'POST',
    headers: {
      'xi-api-key': key,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      text,
      model_id: model,
      voice_settings: { stability: 0.5, similarity_boost: 0.75 },
    }),
  });

  if (!res.ok) {
    throw new Error(`ElevenLabs API error: ${res.status} ${await res.text()}`);
  }

  const data = await res.json();
  const buffer = Buffer.from(data.audio_base64, 'base64');
  const { characters, character_start_times_seconds, character_end_times_seconds } = data.alignment ?? {};
  const words = charsToWordTimings(characters ?? [], character_start_times_seconds ?? [], character_end_times_seconds ?? []);

  return { buffer, words };
}

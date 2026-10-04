#!/usr/bin/env node
// Stage 12: draft and publish a YouTube Short for a published article.
//
// The human gate is the same shape as every other channel in this
// pipeline (see docs/COMPLIANCE.md): drafting never makes anything
// public. A draft IS a real upload to YouTube, but always as
// status: private -- nothing is watchable by anyone except whoever's
// signed into the connected channel until a human reviews the private
// video on youtube.com and this script is run again with --publish
// (or --publish-approved picks up every approved-but-unpublished draft
// unattended, same "approve once, let the daily cron do the clicking"
// split as 5-pinterest-pin.mjs/pinterest-auto-send.yml).
//
// Usage:
//   npm run pipeline:short -- --slug some-article-slug            # draft: script, TTS, B-roll, assemble, upload private
//   npm run pipeline:short -- --slug some-article-slug --publish  # publish one, only if approved
//   npm run pipeline:short -- --publish-approved                  # publish every approved-but-unpublished draft
//
// Unlike pinterest-pin-drafts/ (committed, since a PNG renders directly
// in a PR diff), youtube-short-drafts/ holds only small JSON records --
// the rendered mp4 itself is never committed (too large for a sane repo,
// and git has no useful diff for video anyway). The *actual* review
// surface is the private YouTube upload itself: the draft JSON's
// youtubeStudioUrl is what a reviewer clicks to watch it.

import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { chromium } from 'playwright';
import sharp from 'sharp';
import { loadEnv } from '../lib/env.mjs';
import { askPoe, askPoeForJson, generatePoeImage } from '../lib/poe.mjs';
import { synthesizeSpeech } from '../lib/elevenlabs.mjs';
import { findStockVideo } from '../lib/stock-footage.mjs';
import { uploadVideo, publishVideo, setThumbnail } from '../lib/youtube.mjs';
import { readFrontmatter, insertFrontmatterField } from '../lib/frontmatter.mjs';

loadEnv();
const execFileAsync = promisify(execFile);

const DRAFTS_DIR = 'scripts/pipeline/youtube-short-drafts';
const SITE_URL = 'https://mindtivate.com';
const ARTICLES_DIR = 'src/content/articles';
const WIDTH = 1080;
const HEIGHT = 1920;
const FPS = 30;

const BRAND = { terracotta: '#d97a5f', plum: '#2f2a33', cream: '#f2e9db' };

// Caps how many publishes one run actually does -- same reasoning as
// MAX_SENDS_PER_RUN in 5-pinterest-pin.mjs, but the real hard ceiling
// here is YouTube Data API's default 10,000-units/day quota: a single
// video insert costs ~1,600 units, so even this generous-looking cap
// still leaves headroom for the draft run's own (much cheaper) calls on
// the same day. Raise only after requesting a quota increase from
// Google -- this isn't a cadence preference the way Pinterest's is, it's
// a platform-enforced limit.
const MAX_PUBLISHES_PER_RUN = 4;
const DELAY_BETWEEN_PUBLISHES_MS = 5000;

// A beat ending in "..." is a deliberate open loop (see
// SCRIPT_SYSTEM_PROMPT) -- it needs a beat of silence before cutting to
// the next beat, or the cutoff reads as an edit glitch rather than a
// held pause. Short enough to keep pace on a vertical Short.
const OPEN_LOOP_PAUSE_SECONDS = 0.6;

// Caps how many distinct stock clips one beat's background will stitch
// together to cover its own duration -- see buildBeatBackground. Kept
// low: each extra clip is another search + download, and a beat is
// short enough that 3 real clips is already plenty of visual variety.
const MAX_SEGMENTS_PER_BEAT = 3;

const SCRIPT_SYSTEM_PROMPT = `You write the narration script for a vertical YouTube Short promoting
a Mindtivate article (evidence-based women's health/wellness --
specific, myth-busting, and grounded, never hype-y, preachy, or
diet-culture). The audience is adult women, mostly 28-50, often in a
specific life stage (postpartum, perimenopause/menopause, caregiving,
dating after 30) who are tired of vague or shame-laden advice and want
a direct, research-backed answer to a real question.

Write exactly 2 beats forming one continuous spoken script. This is a
trailer for the article, not a summary of it -- the viewer should finish
the video more curious than informed.
- Beat 1, the HOOK + OPEN LOOP: a specific, counter-intuitive claim that
  stops a scroll in the first 2-3 seconds (often a reversal of common
  advice -- "You've been told X. Here's why that's wrong."), then the
  start of the ONE sharpest point from the article -- but deliberately
  cut it off before it resolves. End mid-explanation, not mid-sentence
  grammatically broken, but clearly incomplete: it names what's
  different/what to pay attention to without yet saying *why* or *how*.
  Example shape: "Turns out it's not about X at all -- it's actually
  about Y, and specifically..." stopping right before the specific part
  lands. One point only, not a list, and never a vague tease with no
  real content ("you won't believe what we found") -- it has to be a
  real, specific claim that's just missing its resolution. Always end
  this beat's text with a literal "..." -- the pipeline detects that and
  inserts a brief dramatic pause there before cutting to beat 2 (see
  OPEN_LOOP_PAUSE_SECONDS below), so the open loop needs a beat to land.
- Beat 2, the CTA: "Visit mindtivate.com to find the answer." or a close,
  natural variation on that same phrasing -- always name the site
  explicitly (there's no clickable link in a Short, so the viewer needs
  to hear the URL, not "the link below"). Keep this to one short
  sentence.

Hard constraints:
- Total spoken script across both beats: 35-55 words. This is short on
  purpose -- resist the urge to explain more than beat 1 allows.
- Never invent statistics or claims not grounded in the article's own
  content, even in the part you're deliberately leaving unresolved.
- Never write as if a real named person is sharing their own personal
  story -- this is Mindtivate's own voice, not a testimonial.
- Each beat also needs a short B-roll search query (2-4 words, like you'd
  type into a stock-footage search box) describing a *visual*, not the
  beat's topic in the abstract. Real people in a natural, everyday
  moment (a couple talking on a couch, someone laughing, hands holding a
  coffee cup) hold attention better than an empty room or an object
  alone -- don't default to people-free shots just to play it safe. The
  one exception is a sensitive topic (postpartum, grief, mental health,
  disability) where an identifiable person on screen can misleadingly
  read as that exact person's real story -- for those, bias toward
  settings/objects/hands instead (see the per-category hint below).
  E.g. for a sleep-insomnia beat that ISN'T sensitive: "woman stretching
  in bed" is a fine, normal choice; reserve "bedroom window moonlight"
  for when the topic specifically calls for keeping people off screen.

Also write a short "videoTitle" (under 80 characters, specific and
curiosity-driving, not the raw article title) and a 2-3 sentence
"videoDescription" ending with a line pointing to mindtivate.com.

Return strict JSON:
{
  "videoTitle": "...",
  "videoDescription": "...",
  "beats": [
    { "text": "...", "broll": "..." }
  ]
}`;

function sensitiveCategoryHint(category) {
  // Loose topical hint only (not a strict allowlist) -- folded into the
  // prompt so Poe's B-roll query choices lean further from identifiable
  // faces specifically for the categories where a stock "testimonial"
  // look is most likely to be misread as a real personal account.
  const sensitive = new Set(['Mind', 'Hormones', 'Life Stages']);
  return sensitive.has(category)
    ? 'This article is in a sensitive category -- bias B-roll queries toward objects/settings/environments only, avoid people entirely if a good non-person query exists.'
    : '';
}

async function generateScript(article, articleBody) {
  return askPoeForJson({
    system: SCRIPT_SYSTEM_PROMPT,
    prompt: `Article title: "${article.title}"\nCategory: ${article.category}\nSEO description: ${article.description}\n${sensitiveCategoryHint(article.category)}\n\nArticle body:\n${articleBody.slice(0, 6000)}`,
    maxTokens: 1200,
  });
}

// Groups a beat's own word-timing array into 2-3-word caption bursts
// (the common "bold word-group" Shorts caption style -- more legible
// than one word flickering at a time, snappier than full-sentence
// blocks) and renders them as an ASS subtitle track. ASS color fields
// are &HAABBGGRR (alpha first, then blue-green-red, hex; alpha 00 =
// fully opaque) -- cream text, plum outline, matching the brand palette
// used everywhere else in this pipeline (pinterest-pin-image.mjs).
function buildCaptionTrack(words, { wordsPerGroup = 3 } = {}) {
  const toAssTime = (seconds) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = (seconds % 60).toFixed(2).padStart(5, '0');
    return `${h}:${String(m).padStart(2, '0')}:${s}`;
  };

  const events = [];
  for (let i = 0; i < words.length; i += wordsPerGroup) {
    const group = words.slice(i, i + wordsPerGroup);
    if (group.length === 0) continue;
    const text = group.map((w) => w.word).join(' ').replace(/[{}]/g, '');
    events.push(`Dialogue: 0,${toAssTime(group[0].start)},${toAssTime(group[group.length - 1].end)},Default,,0,0,0,,${text}`);
  }

  return `[Script Info]
ScriptType: v4.00+
PlayResX: ${WIDTH}
PlayResY: ${HEIGHT}
WrapStyle: 2

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, OutlineColour, BackColour, Bold, Italic, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,76,&H00DBE9F2,&H00332A2F,&H00332A2F,1,0,1,6,0,2,80,80,420,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${events.join('\n')}
`;
}

// Emergency-only visual: a plain branded card, used when a beat's B-roll
// search (both Pexels and Pixabay, see stock-footage.mjs) comes back
// empty -- so a Short is never blocked on stock-footage coverage for an
// unusual search term. Deliberately minimal (no Playwright/CSS reuse
// from pinterest-pin-image.mjs's full theme system -- that's tuned for a
// static image people look at for several seconds; a few of these
// should be rare, not a whole video's look).
async function renderFallbackFrame(category) {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT } });
    await page.setContent(`
      <html><body style="margin:0;width:${WIDTH}px;height:${HEIGHT}px;background:${BRAND.plum};display:flex;align-items:center;justify-content:center;font-family:Georgia,serif;">
        <div style="color:${BRAND.cream};font-size:64px;letter-spacing:4px;text-transform:uppercase;opacity:0.85;">${category}</div>
      </body></html>
    `);
    return await page.screenshot({ type: 'png' });
  } finally {
    await browser.close();
  }
}

async function runFfmpeg(args) {
  try {
    await execFileAsync('ffmpeg', ['-y', '-loglevel', 'error', ...args]);
  } catch (err) {
    throw new Error(`ffmpeg failed: ${err.stderr || err.message}`);
  }
}

// Real, decoded duration of a media file in seconds -- used in
// buildBeatClip to find each beat's own voiceover's true length, which
// almost always runs a little past its last word's own end timestamp
// (ElevenLabs' alignment only covers up to the last transcribed
// character, not any trailing room in the synthesized clip).
async function getMediaDuration(filePath) {
  const { stdout } = await execFileAsync('ffprobe', [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1',
    filePath,
  ]);
  return parseFloat(stdout.trim());
}

// Builds the background video for one beat, covering at least
// `totalDuration` seconds. Fetches distinct stock clips (never the same
// clip twice -- excludeUrls is the shared usedUrls set across the whole
// video) and concatenates them, rather than looping a single short clip
// to fill the time: a 5s clip looped 4x to cover a 20s beat visibly
// repeats on screen and reads as low-effort. Only falls back to
// repeating a clip (the last one fetched) once real sources are
// genuinely exhausted for this query. Returns null if no stock source
// has anything at all, so the caller can fall back to a branded frame.
async function buildBeatBackground({ beat, workDir, index, usedUrls, totalDuration }) {
  const segments = [];
  const attributions = [];
  let accumulated = 0;

  while (accumulated < totalDuration && segments.length < MAX_SEGMENTS_PER_BEAT) {
    const stock = await findStockVideo(beat.broll, { excludeUrls: usedUrls }).catch(() => null);
    if (!stock) break;
    usedUrls.add(stock.sourceUrl);

    const rawPath = join(workDir, `beat-${index}-src-${segments.length}.${stock.ext}`);
    writeFileSync(rawPath, stock.buffer);

    // Re-encode each segment to a common codec/resolution/fps up front
    // so the concat demuxer below can just -c copy them together.
    const segPath = join(workDir, `beat-${index}-seg-${segments.length}.mp4`);
    await runFfmpeg([
      '-i', rawPath,
      '-vf', `scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=increase,crop=${WIDTH}:${HEIGHT}`,
      '-r', String(FPS),
      '-an',
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      segPath,
    ]);

    const segDuration = Math.max(await getMediaDuration(segPath), 0.5);
    segments.push({ path: segPath, duration: segDuration });
    accumulated += segDuration;
    if (stock.sourceName && stock.attribution) {
      attributions.push(`${stock.sourceName}: ${stock.attribution} (${stock.sourceUrl})`);
    }
  }

  if (segments.length === 0) return null;

  // Ran out of distinct clips before covering the beat -- repeat the
  // last one rather than leave the background short. Only reached when
  // this beat's B-roll query truly has nothing else left to offer.
  while (accumulated < totalDuration) {
    const last = segments[segments.length - 1];
    segments.push(last);
    accumulated += last.duration;
  }

  const listPath = join(workDir, `beat-${index}-bg-list.txt`);
  writeFileSync(listPath, segments.map((s) => `file '${s.path}'`).join('\n'));
  const videoPath = join(workDir, `beat-${index}-bg.mp4`);
  await runFfmpeg(['-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', videoPath]);

  return { videoPath, attributions };
}

// Builds one beat's *complete* clip -- its own voiceover, visual, and
// burned-in captions, fully self-contained and already in sync. Each
// beat synthesizes its own audio via a separate ElevenLabs call rather
// than slicing a shared whole-script audio track by word count: the
// earlier design asked Poe for a script, joined every beat's text into
// one string, synthesized that once, then recovered each beat's time
// range by *counting words* in its original text and matching that
// count against ElevenLabs' returned word list. That's fragile --
// anything that makes TTS's actual spoken-word count differ even
// slightly from a naive whitespace split of the input text (an em dash
// with no surrounding spaces, "mindtivate.com" possibly voiced as
// multiple words, any text normalization) silently shifts the cursor,
// and the error compounds beat over beat -- which is exactly why the
// reported symptom was "fine for a while, broken near the end": a video
// track ending early (the last beat's clip sized off an already-wrong
// start time) and captions drifting out of sync well before that.
// Synthesizing per beat sidesteps the whole problem: each beat's audio
// and word timings are guaranteed to describe that exact beat's own
// clip, nothing to keep in sync across beats at all.
async function buildBeatClip({ beat, workDir, index, category, usedUrls }) {
  const outPath = join(workDir, `beat-${index}.mp4`);
  const audioPath = join(workDir, `beat-${index}-audio.mp3`);

  const { buffer: audioBuffer, words } = await synthesizeSpeech({ text: beat.text });
  writeFileSync(audioPath, audioBuffer);
  // See this function's header comment on getMediaDuration -- the real
  // audio can run a little past the last word's own end timestamp, so
  // size the clip off the real decoded duration, not word timing.
  const duration = Math.max(await getMediaDuration(audioPath), 1);

  // A beat ending in "..." is a deliberate open loop (see
  // SCRIPT_SYSTEM_PROMPT) -- hold on it in silence for a beat before
  // cutting away, via ffmpeg's apad audio filter below, rather than
  // cutting the instant the voiceover stops.
  const pauseSeconds = beat.text.trim().endsWith('...') ? OPEN_LOOP_PAUSE_SECONDS : 0;
  const clipDuration = duration + pauseSeconds;

  const captionsPath = join(workDir, `beat-${index}-captions.ass`);
  writeFileSync(captionsPath, buildCaptionTrack(words));

  const background = await buildBeatBackground({ beat, workDir, index, usedUrls, totalDuration: clipDuration }).catch(() => null);

  let videoFilter;
  const inputArgs = [];
  let attributions = [];
  if (background) {
    // Already scaled/cropped to WIDTH x HEIGHT and padded to cover
    // clipDuration by buildBeatBackground -- just burn in captions.
    inputArgs.push('-i', background.videoPath);
    videoFilter = `ass=${captionsPath}`;
    attributions = background.attributions;
  } else {
    const framePath = join(workDir, `beat-${index}-frame.png`);
    writeFileSync(framePath, await renderFallbackFrame(category));
    const frames = Math.max(Math.round(clipDuration * FPS), 1);
    inputArgs.push('-loop', '1', '-i', framePath);
    videoFilter = `scale=${WIDTH * 2}:${HEIGHT * 2},zoompan=z='min(zoom+0.0008,1.15)':d=${frames}:s=${WIDTH}x${HEIGHT}:fps=${FPS},ass=${captionsPath}`;
  }

  await runFfmpeg([
    ...inputArgs,
    '-i', audioPath,
    // apad appends pauseSeconds of silence after the voiceover ends (a
    // no-op when pauseSeconds is 0) so the open-loop pause is real
    // silence in the track, not just an extended video with no sound.
    '-af', `apad=pad_dur=${pauseSeconds}`,
    '-t', String(clipDuration),
    '-vf', videoFilter,
    '-r', String(FPS),
    '-map', '0:v:0',
    '-map', '1:a:0',
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    outPath,
  ]);

  return { outPath, attributions };
}

// Concatenates each beat's already-complete clip (own audio, visual,
// and in-sync captions baked in -- see buildBeatClip) into the final
// video. No cross-beat timing correction needed here: each clip's
// internal audio/video/caption sync came from sharing one local origin
// (its own beat's TTS call), so simple concatenation preserves it.
async function assembleVideo({ beats, category, slug }) {
  const workDir = mkdtempSync(join(tmpdir(), `yt-short-${slug}-`));
  try {
    const usedUrls = new Set();
    const clips = [];
    for (let i = 0; i < beats.length; i++) {
      clips.push(await buildBeatClip({ beat: beats[i], workDir, index: i, category, usedUrls }));
    }

    const listPath = join(workDir, 'concat-list.txt');
    writeFileSync(listPath, clips.map((c) => `file '${c.outPath}'`).join('\n'));
    const outPath = join(workDir, 'final.mp4');
    await runFfmpeg(['-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', outPath]);

    const buffer = readFileSync(outPath);
    return { buffer, attributions: clips.flatMap((c) => c.attributions) };
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

const THUMBNAIL_CONCEPT_SYSTEM = `You write a short visual concept for a YouTube Short's custom thumbnail --
not the video itself, the single static image that gets someone to click
on it in a feed of other thumbnails.

First, from the script below, identify the one specific real-life moment
someone with this exact problem is actually living through right now --
not the topic in the abstract, but a concrete situation: what they're
doing, where they are, what their face and body are doing in that exact
moment of frustration, confusion, exhaustion, or worry. The thumbnail's
whole job is to make someone scrolling who has that exact problem think
"that's literally me" the instant they see it -- that recognition is what
makes them click to find the answer, more than any abstract or
decorative image would.

Then describe that ONE moment as a concrete, high-contrast visual scene
for an image generator -- the person, their expression and body language,
the setting, the mood -- in plain descriptive language, not a list of
keywords. Bold and a little dramatic -- it has to win a half-second
glance -- but never hype-y, clickbait-shocked-face, or misleading about
what the video actually says; the emotion shown has to be the real,
recognizable version of the problem, not an exaggerated parody of it.

No text/words anywhere in the image (YouTube renders the title
separately). If the topic is sensitive (postpartum, grief, mental health,
disability), depict the same specific moment through body language,
hands, or setting instead of a clearly identifiable face.

Return ONLY the final one-to-two sentence visual description itself --
no preamble, no restating these instructions, no labeled sections.`;

// Thumbnail concept comes from a separate, lighter Poe call rather than
// reusing the video script beats directly -- a thumbnail needs its own
// "best single frame" framing, distinct from an individual beat's B-roll
// query. POE_THUMBNAIL_CONCEPT_MODEL defaults to a fast Gemini variant;
// POE_THUMBNAIL_IMAGE_MODEL is the actual image generator (Poe's
// Nano-Banana-2-Lite, per the user's choice -- same bot handle
// 5-pinterest-pin.mjs's infographic style already defaults to) -- both
// overridable since Poe bot handles can change out from under this
// pipeline.
async function generateThumbnailConcept({ article, script }) {
  const prompt = `Video title: "${script.videoTitle}"\nArticle category: ${article.category}\nScript: ${script.beats.map((b) => b.text).join(' ')}`;
  const model = process.env.POE_THUMBNAIL_CONCEPT_MODEL || 'Gemini-2.5-Flash';
  const concept = await askPoe({ system: THUMBNAIL_CONCEPT_SYSTEM, prompt, maxTokens: 300, model });
  return concept.trim();
}

// Generates and sets a custom thumbnail for an already-uploaded video.
// Non-fatal by design (like B-roll sourcing) -- a thumbnail miss
// shouldn't block the whole draft, since the video itself still uploads
// and gets YouTube's own auto-generated thumbnail as a fallback. Returns
// { concept, set: boolean, error? } so the caller can record what
// happened in the draft JSON for human review.
async function generateAndSetThumbnail({ videoId, article, script }) {
  let concept;
  try {
    concept = await generateThumbnailConcept({ article, script });
  } catch (err) {
    return { concept: null, set: false, error: `concept generation failed: ${err.message}` };
  }

  try {
    const imageModel = process.env.POE_THUMBNAIL_IMAGE_MODEL || 'Nano-Banana-2-Lite';
    const { buffer: rawBuffer } = await generatePoeImage({
      prompt: `${concept}\n\nStyle: vivid, high-contrast, vertical-video-friendly composition, no text or words anywhere in the image.`,
      model: imageModel,
    });
    // YouTube's recommended thumbnail size is 1280x720 (16:9) regardless
    // of the video's own vertical aspect ratio -- cover-crop rather than
    // stretch so the generated image's framing survives intact.
    const thumbnailBuffer = await sharp(rawBuffer).resize(1280, 720, { fit: 'cover' }).png().toBuffer();
    await setThumbnail(videoId, thumbnailBuffer, { mimeType: 'image/png' });
    return { concept, set: true };
  } catch (err) {
    return { concept, set: false, error: err.message };
  }
}

async function draftShort(slug) {
  const articlePath = `${ARTICLES_DIR}/${slug}.md`;
  if (!existsSync(articlePath)) throw new Error(`No article found at ${articlePath}`);

  const { data: article, body: articleBody } = readFrontmatter(readFileSync(articlePath, 'utf8'));
  if (article.status !== 'published') {
    throw new Error(`Article status is "${article.status}", not "published". Publish it first.`);
  }

  mkdirSync(DRAFTS_DIR, { recursive: true });
  const draftPath = `${DRAFTS_DIR}/${slug}.json`;

  console.log('Drafting Short script with Poe...');
  const script = await generateScript(article, articleBody);

  console.log(`Synthesizing voiceover, sourcing B-roll, and assembling video (${script.beats.length} beats)...`);
  const { buffer: videoBuffer, attributions } = await assembleVideo({ beats: script.beats, category: article.category, slug });

  const link = `${SITE_URL}/articles/${slug}/`;
  console.log('Uploading to YouTube as private...');
  const uploaded = await uploadVideo({
    buffer: videoBuffer,
    title: script.videoTitle,
    description: `${script.videoDescription}\n\nFull article: ${link}\n\n#Shorts`,
    tags: Array.isArray(article.tags) ? article.tags : [],
  });

  console.log('Generating and setting a custom thumbnail...');
  const thumbnail = await generateAndSetThumbnail({ videoId: uploaded.id, article, script });
  if (!thumbnail.set) {
    console.warn(`  thumbnail not set (${thumbnail.error}) -- video still has YouTube's own auto-generated thumbnail`);
  }

  const draft = {
    slug,
    videoId: uploaded.id,
    youtubeStudioUrl: `https://studio.youtube.com/video/${uploaded.id}/edit`,
    videoTitle: script.videoTitle,
    videoDescription: script.videoDescription,
    script: script.beats.map((b) => b.text),
    broll: script.beats.map((b) => b.broll),
    attributions,
    thumbnailConcept: thumbnail.concept,
    thumbnailSet: thumbnail.set,
    thumbnailError: thumbnail.error ?? null,
    approved: false,
    generatedAt: new Date().toISOString(),
  };
  writeFileSync(draftPath, JSON.stringify(draft, null, 2));

  console.log(`\nDraft written to ${draftPath}`);
  console.log(`Uploaded privately: ${draft.youtubeStudioUrl}`);
  console.log('\nWatch the private video, edit the draft file if needed, set "approved": true,');
  console.log('then re-run this command with --publish.');
  return draft;
}

function listApprovedUnpublishedSlugs() {
  if (!existsSync(DRAFTS_DIR)) return [];
  return readdirSync(DRAFTS_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(`${DRAFTS_DIR}/${f}`, 'utf8')))
    .filter((draft) => draft.approved && !draft.publishedAt)
    .map((draft) => draft.slug);
}

async function publishShort(slug) {
  const draftPath = `${DRAFTS_DIR}/${slug}.json`;
  if (!existsSync(draftPath)) throw new Error(`No draft at ${draftPath} yet. Run without --publish first to generate one.`);

  const draft = JSON.parse(readFileSync(draftPath, 'utf8'));
  if (!draft.approved) throw new Error(`Draft at ${draftPath} is not approved. Review ${draft.youtubeStudioUrl}, set "approved": true first.`);
  if (draft.publishedAt) throw new Error(`Draft was already published at ${draft.publishedAt}.`);

  console.log(`Publishing "${draft.videoTitle}" (${draft.videoId})...`);
  await publishVideo(draft.videoId);

  draft.publishedAt = new Date().toISOString();
  draft.publicUrl = `https://www.youtube.com/shorts/${draft.videoId}`;
  writeFileSync(draftPath, JSON.stringify(draft, null, 2));

  const articlePath = `${ARTICLES_DIR}/${slug}.md`;
  if (existsSync(articlePath)) {
    writeFileSync(articlePath, insertFrontmatterField(readFileSync(articlePath, 'utf8'), 'youtubeShortUrl', draft.publicUrl));
  }

  console.log(`Published: ${draft.publicUrl}`);
  return draft.publicUrl;
}

async function publishApprovedShorts() {
  const slugs = listApprovedUnpublishedSlugs().slice(0, MAX_PUBLISHES_PER_RUN);
  if (slugs.length === 0) {
    console.log('No approved, unpublished Short drafts found.');
    return;
  }

  console.log(`Publishing ${slugs.length} approved draft(s)...`);
  for (const [i, slug] of slugs.entries()) {
    try {
      await publishShort(slug);
    } catch (err) {
      console.error(`  failed to publish "${slug}": ${err.message}`);
    }
    if (i < slugs.length - 1) await new Promise((r) => setTimeout(r, DELAY_BETWEEN_PUBLISHES_MS));
  }
}

function parseArgs(argv) {
  const args = { publish: false, publishApproved: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--slug') args.slug = argv[++i];
    else if (argv[i] === '--publish') args.publish = true;
    else if (argv[i] === '--publish-approved') args.publishApproved = true;
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.publishApproved) {
    await publishApprovedShorts();
    return;
  }

  if (!args.slug) {
    console.error('Usage: npm run pipeline:short -- --slug <article-slug> [--publish]');
    console.error('   or: npm run pipeline:short -- --publish-approved');
    process.exitCode = 1;
    return;
  }

  if (args.publish) {
    await publishShort(args.slug);
  } else {
    await draftShort(args.slug);
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

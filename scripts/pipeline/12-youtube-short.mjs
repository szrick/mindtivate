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
import { loadEnv } from '../lib/env.mjs';
import { askPoeForJson } from '../lib/poe.mjs';
import { synthesizeSpeech } from '../lib/elevenlabs.mjs';
import { findStockVideo } from '../lib/stock-footage.mjs';
import { uploadVideo, publishVideo } from '../lib/youtube.mjs';
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

const SCRIPT_SYSTEM_PROMPT = `You write the narration script for a vertical YouTube Short, 30-44
seconds total, promoting a Mindtivate article (evidence-based women's
health/wellness -- specific, myth-busting, and grounded, never hype-y,
preachy, or diet-culture). The audience is adult women, mostly 28-50,
often in a specific life stage (postpartum, perimenopause/menopause,
caregiving, dating after 30) who are tired of vague or shame-laden
advice and want a direct, research-backed answer to a real question.

Write 3-4 beats forming one continuous spoken script. Be concise and
punchy, not thorough -- this is a hook into the article, not a summary
of it. Cut every sentence that isn't doing real work. No listy
enumeration ("here are three things"), no hedging -- each beat lands
one sharp idea, fast.
- Beat 1, the HOOK: a specific, counter-intuitive claim that stops a
  scroll in the first 2-3 seconds. Often a reversal of common advice
  ("You've been told X. Here's why that's wrong.").
- Beat 2 (and, if there's genuinely a second distinct idea worth the
  extra seconds, beat 3), the PAYOFF: the sharpest, most specific
  insight(s) from the article that actually answer the hook --
  specific, not generic, no filler, no "studies show" without saying
  what they show. Only use a second payoff beat if it's a genuinely
  different point, not a restatement or a minor supporting detail --
  padding to fill time reads as boring, which defeats the point.
- Final beat, the CTA: explicitly tell the viewer to go to mindtivate.com
  for the full breakdown -- say "mindtivate.com" or "Mindtivate" by
  name, not just "the link" or "linked below" (there's no visible link
  for a viewer to click in a Short the way there is on other
  platforms, so the site name has to be spoken). Keep it to one short
  sentence, phrasing varied per video.

Hard constraints:
- Total spoken script across all beats: 80-110 words. Read aloud at a
  natural pace, that's roughly 30-44 seconds. Don't pad to fill this
  range -- a tight 3-beat, 80-word script that lands clean beats a
  4-beat one stretched out to hit 110.
- Never invent statistics or claims not grounded in the article's own
  content.
- Never write as if a real named person is sharing their own personal
  story -- this is Mindtivate's own voice, not a testimonial.
- Each beat also needs a short B-roll search query (2-4 words, like you'd
  type into a stock-footage search box) describing a *visual*, not the
  beat's topic in the abstract. Prefer settings, objects, hands, and
  environments over identifiable faces -- a stock clip of a specific
  person can misleadingly read as that person's real story, especially
  for sensitive topics (postpartum, grief, mental health, disability).
  E.g. for a sleep-insomnia beat: "person awake at night" is worse than
  "bedroom window moonlight" or "alarm clock early morning".

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

// Walks the full-script word-timing array, consuming each beat's own
// word count in order, so every beat ends up with a [start, end] range
// within the single synthesized audio track. Relies on beat texts being
// sent to TTS in the same order, space-joined, with no added/removed
// words -- see draftShort's fullText below.
function assignBeatTimings(beats, words) {
  let cursor = 0;
  return beats.map((beat) => {
    const wordCount = beat.text.trim().split(/\s+/).length;
    const beatWords = words.slice(cursor, cursor + wordCount);
    cursor += wordCount;
    const start = beatWords[0]?.start ?? 0;
    const end = beatWords[beatWords.length - 1]?.end ?? start;
    return { ...beat, start, end, words: beatWords };
  });
}

// Groups the full-script word-timing array into 2-3-word caption bursts
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

// Real, decoded duration of a media file in seconds -- used two ways in
// assembleVideo: (1) the TTS audio's true length almost always runs a
// little past the last word's own end timestamp (trailing room in the
// synthesized clip beyond the last transcribed character), so sizing the
// last beat's video off word timing alone left the video track shorter
// than the audio -- the final ffmpeg pass's `-shortest` then silently
// truncated the *voice*, not just dead air. (2) each beat's video clip
// is independently encoded, and ffmpeg's `-t` trim only lands on a frame
// boundary (nearest 1/FPS), not the exact requested duration -- small
// per-clip rounding that compounds across beats, so captions (timed
// against the one continuous original audio track) drift visibly out of
// sync with the concatenated video by the last beat. Probing each beat
// clip's *actual* rendered duration afterward and correcting caption
// times against that real cumulative timeline (see assembleVideo) fixes
// both at the root rather than just padding/guessing.
async function getMediaDuration(filePath) {
  const { stdout } = await execFileAsync('ffprobe', [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1',
    filePath,
  ]);
  return parseFloat(stdout.trim());
}

// Builds one beat's visual clip: a real stock video trimmed to
// `duration` (the caller's responsibility -- see assembleVideo, which
// extends the last beat's nominal duration to cover the full audio
// track) and cropped/scaled to fill 1080x1920, or (fallback) a static
// branded frame panned slowly via zoompan so a run of fallback beats
// doesn't look like a dead still image. Returns the clip's *actual*
// rendered duration (probed, not just the requested one) alongside its
// path, so the caller can correct caption timing against reality -- see
// getMediaDuration's comment for why requested and actual can differ.
async function buildBeatClip({ beat, duration: requestedDuration, workDir, index, category, usedUrls }) {
  const duration = Math.max(requestedDuration, 1);
  const outPath = join(workDir, `beat-${index}.mp4`);

  const stock = await findStockVideo(beat.broll, { excludeUrls: usedUrls }).catch(() => null);

  if (stock) {
    usedUrls.add(stock.sourceUrl);
    const srcPath = join(workDir, `beat-${index}-src.${stock.ext}`);
    writeFileSync(srcPath, stock.buffer);
    await runFfmpeg([
      '-i', srcPath,
      '-t', String(duration),
      '-vf', `scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=increase,crop=${WIDTH}:${HEIGHT}`,
      '-r', String(FPS),
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      '-an',
      outPath,
    ]);
    return {
      outPath,
      actualDuration: await getMediaDuration(outPath),
      attribution: stock.sourceName && stock.attribution ? `${stock.sourceName}: ${stock.attribution} (${stock.sourceUrl})` : null,
    };
  }

  const framePath = join(workDir, `beat-${index}-frame.png`);
  writeFileSync(framePath, await renderFallbackFrame(category));
  const frames = Math.max(Math.round(duration * FPS), 1);
  await runFfmpeg([
    '-loop', '1',
    '-i', framePath,
    '-t', String(duration),
    '-vf', `scale=${WIDTH * 2}:${HEIGHT * 2},zoompan=z='min(zoom+0.0008,1.15)':d=${frames}:s=${WIDTH}x${HEIGHT}:fps=${FPS}`,
    '-r', String(FPS),
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    outPath,
  ]);
  return { outPath, actualDuration: await getMediaDuration(outPath), attribution: null };
}

async function assembleVideo({ beats, audioBuffer, category, slug }) {
  const workDir = mkdtempSync(join(tmpdir(), `yt-short-${slug}-`));
  try {
    const audioPath = join(workDir, 'voiceover.mp3');
    writeFileSync(audioPath, audioBuffer);

    // The synthesized audio's real length almost always runs a little
    // past the last word's own end timestamp (ElevenLabs' alignment only
    // covers up to the last transcribed character, not any trailing room
    // in the clip) -- size the last beat's video to cover the *whole*
    // audio, not just up to the last word, so the final assembly's
    // `-shortest` never truncates real speech. See getMediaDuration's
    // comment for the fuller picture.
    const audioDuration = await getMediaDuration(audioPath);
    const nominalDurations = beats.map((beat, i) =>
      i === beats.length - 1 ? Math.max(audioDuration - beat.start, beat.end - beat.start) : beat.end - beat.start,
    );

    const usedUrls = new Set();
    const clips = [];
    for (let i = 0; i < beats.length; i++) {
      clips.push(await buildBeatClip({ beat: beats[i], duration: nominalDurations[i], workDir, index: i, category, usedUrls }));
    }

    const listPath = join(workDir, 'concat-list.txt');
    writeFileSync(listPath, clips.map((c) => `file '${c.outPath}'`).join('\n'));
    const concatPath = join(workDir, 'concat.mp4');
    await runFfmpeg(['-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', concatPath]);

    // Each clip's *actual* rendered duration (probed above, in
    // buildBeatClip) almost never matches its requested one exactly --
    // ffmpeg's `-t` trim lands on the nearest frame boundary, not the
    // exact second. That per-clip rounding is imperceptible alone, but
    // compounds across beats; correct every word's caption time by the
    // *cumulative* real offset of the beat it falls in (not the nominal
    // one the original TTS timeline assumed), so captions track the
    // concatenated video's real timeline instead of drifting from it by
    // the final beat.
    let cumulativeActualOffset = 0;
    const correctedWords = [];
    for (let i = 0; i < beats.length; i++) {
      const offsetCorrection = cumulativeActualOffset - beats[i].start;
      for (const word of beats[i].words) {
        correctedWords.push({ word: word.word, start: word.start + offsetCorrection, end: word.end + offsetCorrection });
      }
      cumulativeActualOffset += clips[i].actualDuration;
    }

    const captionsPath = join(workDir, 'captions.ass');
    writeFileSync(captionsPath, buildCaptionTrack(correctedWords));

    const outPath = join(workDir, 'final.mp4');
    await runFfmpeg([
      '-i', concatPath,
      '-i', audioPath,
      '-vf', `ass=${captionsPath}`,
      '-map', '0:v:0',
      '-map', '1:a:0',
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac',
      '-shortest',
      outPath,
    ]);

    const buffer = readFileSync(outPath);
    return { buffer, attributions: clips.map((c) => c.attribution).filter(Boolean) };
  } finally {
    rmSync(workDir, { recursive: true, force: true });
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
  const fullText = script.beats.map((b) => b.text).join(' ');

  console.log('Synthesizing voiceover with ElevenLabs...');
  const { buffer: audioBuffer, words } = await synthesizeSpeech({ text: fullText });
  const beats = assignBeatTimings(script.beats, words);

  console.log(`Sourcing B-roll and assembling video (${beats.length} beats)...`);
  const { buffer: videoBuffer, attributions } = await assembleVideo({ beats, audioBuffer, category: article.category, slug });

  const link = `${SITE_URL}/articles/${slug}/`;
  console.log('Uploading to YouTube as private...');
  const uploaded = await uploadVideo({
    buffer: videoBuffer,
    title: script.videoTitle,
    description: `${script.videoDescription}\n\nFull article: ${link}\n\n#Shorts`,
    tags: Array.isArray(article.tags) ? article.tags : [],
  });

  const draft = {
    slug,
    videoId: uploaded.id,
    youtubeStudioUrl: `https://studio.youtube.com/video/${uploaded.id}/edit`,
    videoTitle: script.videoTitle,
    videoDescription: script.videoDescription,
    script: script.beats.map((b) => b.text),
    broll: script.beats.map((b) => b.broll),
    attributions,
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

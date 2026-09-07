#!/usr/bin/env node
// Stage 5: draft and create a Pinterest pin for a published article.
//
// The human gate is drafting -> approved:true, not the send command
// itself: drafting never posts anything (renders the pin image, asks
// Poe for the pin's wording, writes both to
// scripts/pipeline/pinterest-pin-drafts/ for review), and nothing is
// ever sent without a human having set "approved": true on that draft
// first. What IS optional is whether the actual send happens locally by
// hand (--send) or unattended for anything already approved
// (--send-approved, see pinterest-auto-send.yml) -- either way, Pinterest
// never sees a draft nobody reviewed.
//
// Unlike stages 6/7's drafts (scripts/pipeline/output/, gitignored,
// purely local), this one's drafts directory is deliberately NOT
// gitignored: weekly-pinterest-pins.yml runs the drafting half on a
// schedule and opens a PR with the results, since Pinterest has no
// built-in "unsent draft" state the way Resend broadcasts do (send:false)
// — a real image + real copy in a real PR diff is the review surface
// instead.
//
// Usage:
//   npm run pipeline:pin -- --slug some-article-slug                        # draft only, photo style
//   npm run pipeline:pin -- --slug some-article-slug --style infographic    # draft only, infographic style
//   npm run pipeline:pin -- --slug some-article-slug --send                 # send one, only if approved
//   npm run pipeline:pin -- --send-approved                                 # send every approved-but-unsent draft
//
// --style infographic: a Nano-Banana-2-Lite-generated illustrated
// background (POE_INFOGRAPHIC_MODEL) with 3-4 real, always-legible
// takeaway bullets composited on top — see buildInfographicPrompt below
// and renderInfographicPinImage in pinterest-pin-image.mjs for why the
// text is composited rather than trusting the image model to render it:
// small baked-in text from image-gen models is still unreliable
// (misspelled/garbled), so the model only ever supplies art, never text.
// Defaults to the original photo style (article hero + gradient scrim)
// when omitted -- this is an opt-in alternative, not a replacement, until
// its quality has been reviewed against real articles.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { loadEnv } from '../lib/env.mjs';
import { askPoeForJson, generatePoeImage } from '../lib/poe.mjs';
import { readFrontmatter, insertFrontmatterField } from '../lib/frontmatter.mjs';
import { createPin, resolveBoardId, refreshAccessToken } from '../lib/pinterest.mjs';
import { renderPinImage, renderInfographicPinImage } from '../lib/pinterest-pin-image.mjs';

loadEnv();

const DRAFTS_DIR = 'scripts/pipeline/pinterest-pin-drafts';
const SITE_URL = 'https://mindtivate.com';
const ARTICLES_DIR = 'src/content/articles';

const SYSTEM_PROMPT = `You write the wording for a Pinterest pin promoting a Mindtivate article
(evidence-based women's health/wellness — specific and grounded, never
hype-y or diet-culture). You're given the article's title, category, and
its on-page SEO description. Write fresh copy for Pinterest, not a copy
of the SEO description — Pinterest has its own conventions.

Write four things:
- imageHeadline: the bold text that goes ON the pin image itself. Short —
  it has to read at a glance in a scrolling feed. Under 60 characters,
  1-2 short lines' worth. A real hook, not a label.
- imageSubtext: one short supporting line under the headline, also on the
  image. Under 90 characters.
- pinTitle: Pinterest's title field (shown in search/related-pins, not
  necessarily on the image itself) — can restate or sharpen the headline,
  keyword-forward since Pinterest is a search engine as much as a feed.
  Under 100 characters.
- pinDescription: Pinterest's longer description field. 1-3 sentences,
  can include relevant keywords naturally, ends with a soft nudge to read
  more (not "click here" — describe what they'll find).

Rules:
- No hype ("You won't believe...", "This one trick"), no medical claims,
  no "shocking" / "secret" / "amazing" language.
- Do not mention that you are an AI or that this was generated.

Output strict JSON only: {"imageHeadline": "...", "imageSubtext": "...", "pinTitle": "...", "pinDescription": "..."}`;

// Adds fields on top of SYSTEM_PROMPT's four, and — unlike that one — is
// given the article's actual body, not just its title/description, so
// the content is grounded in what the article actually says rather than
// invented from the headline alone.
//
// layoutStyle is the actual variety mechanism: rather than every
// infographic defaulting to the same generic bullet-list shape, Poe
// picks whichever of four real infographic layouts
// (visme.co/blog/types-of-infographics, piktochart.com/blog/types-of-infographics,
// among other design references) genuinely fits this article's content
// -- forcing e.g. "comparison" onto an article with nothing to compare
// would produce a worse pin than just picking "list". `items` uses one
// shared {label, sublabel?} shape across all four styles so
// renderInfographicPinImage (pinterest-pin-image.mjs) only needs one
// generic card layout per style, not bespoke parsing per style.
const INFOGRAPHIC_SYSTEM_PROMPT = `${SYSTEM_PROMPT.replace(
  'Output strict JSON only: {"imageHeadline": "...", "imageSubtext": "...", "pinTitle": "...", "pinDescription": "..."}',
  '',
)}
Also decide the infographic's layout and content:

- layoutStyle: pick whichever ONE of these four actually fits this
  article's content best -- don't force a style the content doesn't
  support:
  - "list": general takeaways or tips with no inherent order or
    contrast. The safe default when nothing else clearly fits.
  - "process": the content is inherently a sequence of steps done in
    order (e.g. "how to do X").
  - "comparison": the content genuinely contrasts exactly two things
    (two options, before/after, this vs. that) -- only pick this when
    there really are two sides to show.
  - "stat": the article centers on 1-3 specific, quotable numbers from
    real research/data mentioned in the article (a dose, a ratio, a
    percentage, a duration) -- only pick this when the article actually
    states real numbers; never invent one to justify this style.
- items: content matching layoutStyle, each as {"label": string,
  "sublabel": string (omit/empty for "list" and "process")}:
  - list: exactly 3 items, label = a short, concrete, factually-grounded
    takeaway (under 55 characters).
  - process: 3-4 items, label = one step, in the order they're actually
    done (under 45 characters each -- a number gets prefixed
    automatically, don't include one yourself).
  - comparison: exactly 2 items, label = short name for that side (under
    20 characters), sublabel = one short supporting phrase for it (under
    45 characters).
  - stat: 1-3 items, label = the number/figure itself exactly as stated
    in the article (e.g. "40:1", "2-4g", "30 days"), sublabel = under 45
    characters explaining what it means.
  All item text renders as real on-image text, so it must be accurate to
  the article, never invented.
- backgroundScene: a short (1 sentence) description of a real-world
  scene, object, or setting relevant to the article's topic, suitable as
  an illustration background — no people's faces close-up (renders
  poorly at small pin sizes), no text/words/numbers/labels in the scene
  itself (a separate step overlays real text on top of this art).

Output strict JSON only: {"imageHeadline": "...", "imageSubtext": "...", "pinTitle": "...", "pinDescription": "...", "layoutStyle": "list"|"process"|"comparison"|"stat", "items": [{"label": "...", "sublabel": "..."}], "backgroundScene": "..."}`;

// Varies the AI art's own compositional framing to match layoutStyle, on
// top of the scene Poe picked -- e.g. a "process" article gets a hint of
// left-to-right progression in how objects are arranged, not just a
// static grouping. Keeps the "no text at all" constraint absolute
// regardless of style: the model only ever supplies art, real text is
// always composited afterward (see renderInfographicPinImage).
const LAYOUT_COMPOSITION_HINTS = {
  list: 'Clean, uncluttered composition with a single clear focal grouping.',
  process: 'Composition suggests a left-to-right sequence or progression -- objects arranged to imply moving from a starting point toward a result.',
  comparison: 'Composition is visually divided into two distinct zones or two contrasting groupings of objects, suggesting two sides.',
  stat: 'Composition centers on one bold, singular focal object or symbol representing the key idea, with generous open negative space around it.',
};

function buildInfographicImagePrompt(backgroundScene, category, layoutStyle) {
  const compositionHint = LAYOUT_COMPOSITION_HINTS[layoutStyle] || LAYOUT_COMPOSITION_HINTS.list;
  return `Flat-illustration, editorial-infographic style artwork for a women's health and wellness Pinterest pin, category: ${category}. Scene: ${backgroundScene}. ${compositionHint} Warm, inviting color palette (terracotta, plum, cream tones). Clean composition with open, uncluttered space in the lower third for a text overlay to be added afterward. STRICT CONSTRAINT: absolutely no text, no words, no letters, no numbers, no labels, no writing of any kind anywhere in the image -- illustration only.`;
}

function parseArgs(argv) {
  const args = { send: false, sendApproved: false, style: 'photo' };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--slug') args.slug = argv[++i];
    else if (argv[i] === '--send') args.send = true;
    else if (argv[i] === '--send-approved') args.sendApproved = true;
    else if (argv[i] === '--style') args.style = argv[++i];
  }
  return args;
}

// heroImage in an article's frontmatter is a path relative to
// src/content/articles/ (e.g. "./_images/foo-hero.png"), the same way
// Astro's own image() schema helper resolves it — this script runs
// outside Astro, so it has to do that resolution itself. Falls back to
// the site's generic OG image for articles with no hero set at all.
function resolveHeroImagePath(heroImage) {
  if (!heroImage) return 'public/og-default.svg';
  const cleaned = heroImage.replace(/^\.\//, '');
  return `${ARTICLES_DIR}/${cleaned}`;
}

// If a refresh token is configured (PINTEREST_APP_ID/APP_SECRET/
// REFRESH_TOKEN — all optional), mint a fresh access token for this
// process rather than relying on a static PINTEREST_ACCESS_TOKEN that
// expires every 30 days. createPin/resolveBoardId both already default
// to reading PINTEREST_ACCESS_TOKEN from the environment, so setting it
// here once is enough for every send in this run to pick it up. No-op
// (keeps whatever PINTEREST_ACCESS_TOKEN is already set, if any) when
// the refresh vars aren't configured -- see docs/SETUP.md.
async function ensureFreshAccessToken() {
  try {
    const token = await refreshAccessToken();
    if (token) process.env.PINTEREST_ACCESS_TOKEN = token;
  } catch (err) {
    console.warn(`Pinterest token refresh skipped: ${err.message}`);
  }
}

// Sends one already-drafted, already-approved pin. Throws (with a
// message describing exactly what's missing/wrong) rather than
// exitCode-ing directly, so both the single-slug --send path and the
// bulk --send-approved path can handle a failure their own way (the
// former exits non-zero, the latter logs and moves on to the next one).
async function sendDraft(slug) {
  const articlePath = `${ARTICLES_DIR}/${slug}.md`;
  const draftPath = `${DRAFTS_DIR}/${slug}.json`;
  const imagePath = `${DRAFTS_DIR}/${slug}.png`;
  const link = `${SITE_URL}/articles/${slug}/`;

  if (!existsSync(articlePath)) throw new Error(`No article found at ${articlePath}`);
  if (!existsSync(draftPath)) throw new Error(`No draft at ${draftPath} yet. Run without --send first to generate one.`);

  const draft = JSON.parse(readFileSync(draftPath, 'utf8'));
  if (!draft.approved) {
    throw new Error(`Draft at ${draftPath} is not approved. Review it (and ${imagePath}), set "approved": true first.`);
  }
  if (draft.sentAt) {
    throw new Error(`Draft was already sent at ${draft.sentAt} (pin: ${draft.pinUrl}).`);
  }
  if (!existsSync(imagePath)) {
    throw new Error(`Draft image missing at ${imagePath}. Delete ${draftPath} and re-run without --send to regenerate both.`);
  }

  const { data: article } = readFrontmatter(readFileSync(articlePath, 'utf8'));
  const boardId = resolveBoardId(article.category);
  if (!boardId) {
    throw new Error(
      `No Pinterest board configured for category "${article.category}" — set it in scripts/lib/pinterest-boards.json, or set PINTEREST_BOARD_ID as a catch-all.`,
    );
  }

  console.log(`Creating Pinterest pin on board ${boardId}: "${draft.pinTitle}"...`);
  const imageBase64 = readFileSync(imagePath).toString('base64');
  const pin = await createPin({
    title: draft.pinTitle,
    description: draft.pinDescription,
    link,
    imageBase64,
    imageContentType: 'image/png',
    boardId,
  });

  const pinUrl = `https://www.pinterest.com/pin/${pin.id}/`;
  draft.sentAt = new Date().toISOString();
  draft.pinUrl = pinUrl;
  writeFileSync(draftPath, JSON.stringify(draft, null, 2));

  const updatedArticle = insertFrontmatterField(readFileSync(articlePath, 'utf8'), 'pinterestPinUrl', pinUrl);
  writeFileSync(articlePath, updatedArticle);

  console.log(`Created pin: ${pinUrl}`);
  console.log(`Recorded pinterestPinUrl in ${articlePath}.`);
  return pinUrl;
}

// Caps how many pins one run actually sends -- COMPLIANCE.md warns
// against a "scripted bulk-pin loop" per Pinterest's spam policy, and a
// pile of drafts all getting approved around the same time (e.g. after
// merging several review PRs at once) shouldn't turn into a burst of
// simultaneous posts just because the automation runs on a schedule.
// Whatever's left over just waits for the next scheduled run.
const MAX_SENDS_PER_RUN = 5;
const DELAY_BETWEEN_SENDS_MS = 5000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function listApprovedUnsentSlugs() {
  if (!existsSync(DRAFTS_DIR)) return [];
  return readdirSync(DRAFTS_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(`${DRAFTS_DIR}/${f}`, 'utf8')))
    .filter((draft) => draft.approved && !draft.sentAt)
    .map((draft) => draft.slug);
}

async function sendApprovedDrafts() {
  const slugs = listApprovedUnsentSlugs().slice(0, MAX_SENDS_PER_RUN);
  if (slugs.length === 0) {
    console.log('No approved, unsent Pinterest pin drafts found.');
    return;
  }

  await ensureFreshAccessToken();

  console.log(`Sending ${slugs.length} approved draft(s)...`);
  for (const [i, slug] of slugs.entries()) {
    try {
      await sendDraft(slug);
    } catch (err) {
      console.error(`  failed to send "${slug}": ${err.message}`);
    }
    if (i < slugs.length - 1) await sleep(DELAY_BETWEEN_SENDS_MS);
  }
}

async function run() {
  const args = parseArgs(process.argv.slice(2));

  if (args.sendApproved) {
    await sendApprovedDrafts();
    return;
  }

  if (!args.slug) {
    console.error('Usage: npm run pipeline:pin -- --slug <article-slug> [--style photo|infographic] [--send]');
    console.error('   or: npm run pipeline:pin -- --send-approved');
    process.exitCode = 1;
    return;
  }
  if (args.style !== 'photo' && args.style !== 'infographic') {
    console.error(`Unknown --style "${args.style}". Use "photo" (default) or "infographic".`);
    process.exitCode = 1;
    return;
  }

  if (args.send) {
    await ensureFreshAccessToken();
    try {
      await sendDraft(args.slug);
    } catch (err) {
      console.error(err.message);
      process.exitCode = 1;
    }
    return;
  }

  const articlePath = `${ARTICLES_DIR}/${args.slug}.md`;
  if (!existsSync(articlePath)) {
    console.error(`No article found at ${articlePath}`);
    process.exitCode = 1;
    return;
  }
  const { data: article, body: articleBody } = readFrontmatter(readFileSync(articlePath, 'utf8'));
  if (article.status !== 'published') {
    console.error(`Article status is "${article.status}", not "published". Publish it first.`);
    process.exitCode = 1;
    return;
  }

  mkdirSync(DRAFTS_DIR, { recursive: true });
  const draftPath = `${DRAFTS_DIR}/${args.slug}.json`;
  const imagePath = `${DRAFTS_DIR}/${args.slug}.png`;
  const link = `${SITE_URL}/articles/${args.slug}/`;

  console.log('Drafting Pinterest copy with Poe...');
  const copy = await askPoeForJson({
    system: args.style === 'infographic' ? INFOGRAPHIC_SYSTEM_PROMPT : SYSTEM_PROMPT,
    prompt:
      args.style === 'infographic'
        ? `Article title: "${article.title}"\nCategory: ${article.category}\nSEO description: ${article.description}\n\nArticle body:\n${articleBody.slice(0, 6000)}`
        : `Article title: "${article.title}"\nCategory: ${article.category}\nSEO description: ${article.description}`,
    maxTokens: args.style === 'infographic' ? 900 : 700,
  });

  let imageBuffer;
  if (args.style === 'infographic') {
    console.log(`Generating infographic background art with Poe (layout: ${copy.layoutStyle})...`);
    const infographicModel = process.env.POE_INFOGRAPHIC_MODEL || 'Nano-Banana-2-Lite';
    const backgroundImage = await generatePoeImage({
      prompt: buildInfographicImagePrompt(copy.backgroundScene, article.category, copy.layoutStyle),
      model: infographicModel,
    });

    console.log('Rendering infographic pin image...');
    imageBuffer = await renderInfographicPinImage({
      backgroundImage,
      category: article.category,
      headline: copy.imageHeadline,
      layoutStyle: copy.layoutStyle,
      items: copy.items,
    });
  } else {
    console.log('Rendering pin image...');
    const heroImagePath = resolveHeroImagePath(article.heroImage);
    imageBuffer = await renderPinImage({
      heroImagePath,
      category: article.category,
      headline: copy.imageHeadline,
      subtext: copy.imageSubtext,
    });
  }
  mkdirSync(DRAFTS_DIR, { recursive: true });
  writeFileSync(imagePath, imageBuffer);

  const draft = {
    slug: args.slug,
    articleTitle: article.title,
    category: article.category,
    articleLink: link,
    imagePath,
    style: args.style,
    ...copy,
    approved: false,
    generatedAt: new Date().toISOString(),
  };
  writeFileSync(draftPath, JSON.stringify(draft, null, 2));

  console.log(`\nDraft written to ${draftPath}`);
  console.log(`Image written to ${imagePath}`);
  console.log(`Image headline: ${copy.imageHeadline}`);
  console.log(`Pin title: ${copy.pinTitle}`);
  console.log('\nReview the image and copy, edit any field if needed, set "approved": true,');
  console.log('then re-run this command with --send.');
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

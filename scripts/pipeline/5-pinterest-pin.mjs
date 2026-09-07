#!/usr/bin/env node
// Stage 5: draft and create a Pinterest pin for a published article.
//
// Two-step, human-gated (same pattern as stages 6/7): drafting never
// posts anything. It renders the pin image, asks Poe for the pin's
// wording, and writes both to scripts/pipeline/pinterest-pin-drafts/ for
// review. Only --send, after approved:true, actually calls Pinterest.
//
// Unlike stages 6/7's drafts (scripts/pipeline/output/, gitignored,
// purely local), this one's drafts directory is deliberately NOT
// gitignored: weekly-pinterest-pins.yml runs the drafting half on a
// schedule and opens a PR with the results, since Pinterest has no
// built-in "unsent draft" state the way Resend broadcasts do (send:false)
// — a real image + real copy in a real PR diff is the review surface
// instead. --send still only ever runs locally, by a human, same as
// every other "goes out publicly" step in this pipeline.
//
// Usage:
//   npm run pipeline:pin -- --slug some-article-slug                        # draft only, photo style
//   npm run pipeline:pin -- --slug some-article-slug --style infographic    # draft only, infographic style
//   npm run pipeline:pin -- --slug some-article-slug --send                 # send, only if approved
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

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { loadEnv } from '../lib/env.mjs';
import { askPoeForJson, generatePoeImage } from '../lib/poe.mjs';
import { readFrontmatter, insertFrontmatterField } from '../lib/frontmatter.mjs';
import { createPin, resolveBoardId } from '../lib/pinterest.mjs';
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

// Adds two fields on top of SYSTEM_PROMPT's four, and — unlike that one —
// is given the article's actual body, not just its title/description, so
// the takeaways are grounded in what the article actually says rather
// than invented from the headline alone.
const INFOGRAPHIC_SYSTEM_PROMPT = `${SYSTEM_PROMPT.replace(
  'Output strict JSON only: {"imageHeadline": "...", "imageSubtext": "...", "pinTitle": "...", "pinDescription": "..."}',
  '',
)}
Also write:
- takeaways: exactly 3 short, concrete, factually-grounded bullet points
  from the article's actual content (not generic advice) — each under 55
  characters, punchy enough to read at a glance on a pin. These render as
  real on-image text, so they must be accurate to the article, not
  invented.
- backgroundScene: a short (1 sentence) description of a real-world
  scene, object, or setting relevant to the article's topic, suitable as
  an illustration background — no people's faces close-up (renders
  poorly at small pin sizes), no text/words/numbers/labels in the scene
  itself (a separate step overlays real text on top of this art).

Output strict JSON only: {"imageHeadline": "...", "imageSubtext": "...", "pinTitle": "...", "pinDescription": "...", "takeaways": ["...", "...", "..."], "backgroundScene": "..."}`;

function buildInfographicImagePrompt(backgroundScene, category) {
  return `Flat-illustration, editorial-infographic style artwork for a women's health and wellness Pinterest pin, category: ${category}. Scene: ${backgroundScene}. Warm, inviting color palette (terracotta, plum, cream tones). Clean composition with open, uncluttered space in the lower third for a text overlay to be added afterward. STRICT CONSTRAINT: absolutely no text, no words, no letters, no numbers, no labels, no writing of any kind anywhere in the image -- illustration only.`;
}

function parseArgs(argv) {
  const args = { send: false, style: 'photo' };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--slug') args.slug = argv[++i];
    else if (argv[i] === '--send') args.send = true;
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

async function run() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.slug) {
    console.error('Usage: npm run pipeline:pin -- --slug <article-slug> [--style photo|infographic] [--send]');
    process.exitCode = 1;
    return;
  }
  if (args.style !== 'photo' && args.style !== 'infographic') {
    console.error(`Unknown --style "${args.style}". Use "photo" (default) or "infographic".`);
    process.exitCode = 1;
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

  if (args.send) {
    if (!existsSync(draftPath)) {
      console.error(`No draft at ${draftPath} yet. Run without --send first to generate one.`);
      process.exitCode = 1;
      return;
    }
    const draft = JSON.parse(readFileSync(draftPath, 'utf8'));
    if (!draft.approved) {
      console.error(`Draft at ${draftPath} is not approved. Review it (and ${imagePath}), set "approved": true, then re-run with --send.`);
      process.exitCode = 1;
      return;
    }
    if (draft.sentAt) {
      console.error(`Draft was already sent at ${draft.sentAt} (pin: ${draft.pinUrl}). Delete that field (or the whole file) to re-send.`);
      process.exitCode = 1;
      return;
    }
    if (!existsSync(imagePath)) {
      console.error(`Draft image missing at ${imagePath}. Delete ${draftPath} and re-run without --send to regenerate both.`);
      process.exitCode = 1;
      return;
    }

    const boardId = resolveBoardId(article.category);
    if (!boardId) {
      console.error(
        `No Pinterest board configured for category "${article.category}" — set it in scripts/lib/pinterest-boards.json, or set PINTEREST_BOARD_ID as a catch-all in .env.`,
      );
      process.exitCode = 1;
      return;
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
    return;
  }

  console.log('Drafting Pinterest copy with Poe...');
  const copy = await askPoeForJson({
    system: args.style === 'infographic' ? INFOGRAPHIC_SYSTEM_PROMPT : SYSTEM_PROMPT,
    prompt:
      args.style === 'infographic'
        ? `Article title: "${article.title}"\nCategory: ${article.category}\nSEO description: ${article.description}\n\nArticle body:\n${articleBody.slice(0, 6000)}`
        : `Article title: "${article.title}"\nCategory: ${article.category}\nSEO description: ${article.description}`,
    maxTokens: 700,
  });

  let imageBuffer;
  if (args.style === 'infographic') {
    console.log('Generating infographic background art with Poe...');
    const infographicModel = process.env.POE_INFOGRAPHIC_MODEL || 'Nano-Banana-2-Lite';
    const backgroundImage = await generatePoeImage({
      prompt: buildInfographicImagePrompt(copy.backgroundScene, article.category),
      model: infographicModel,
    });

    console.log('Rendering infographic pin image...');
    imageBuffer = await renderInfographicPinImage({
      backgroundImage,
      category: article.category,
      headline: copy.imageHeadline,
      takeaways: copy.takeaways,
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

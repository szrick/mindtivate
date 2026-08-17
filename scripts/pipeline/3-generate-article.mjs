#!/usr/bin/env node
// Stage 3: draft an article from a researched pain point (+ optional
// matched product) using Poe. Always writes with status: draft,
// draft: true — nothing this script produces is publishable until a human
// reviews it (in Pages CMS or a PR) and flips status to published.
//
// Also via Poe: a best-effort search for real authority sources to cite
// (POE_SEARCH_MODEL) and a generated hero illustration + product image
// (POE_IMAGE_MODEL). Both are non-fatal — if either fails, drafting
// continues without it rather than blocking the whole run.
//
// Usage:
//   npm run pipeline:draft -- --index 0 [--product some-product-slug] [--briefs path.json] [--template id]
//
// --template selects the structural shape (word count, section layout,
// style) from scripts/lib/article-templates.mjs. Defaults to "standard".
// Run with an unknown id to see the list of available ones.

import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { loadEnv } from '../lib/env.mjs';
import { askPoeForJson, searchAuthoritySources, generatePoeImage, findAmazonProductImage } from '../lib/poe.mjs';
import { writeMarkdownFile, slugify, readFrontmatter, insertFrontmatterField } from '../lib/frontmatter.mjs';
import { ARTICLE_TEMPLATES, listTemplateIds } from '../lib/article-templates.mjs';

loadEnv();

function parseArgs(argv) {
  const args = { index: 0, template: 'standard' };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--index') args.index = Number(argv[++i]);
    else if (argv[i] === '--product') args.product = argv[++i];
    else if (argv[i] === '--briefs') args.briefs = argv[++i];
    else if (argv[i] === '--template') args.template = argv[++i];
  }
  return args;
}

function latestBriefsFile() {
  const dir = 'scripts/pipeline/output';
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir).filter((f) => f.startsWith('product-briefs-') && f.endsWith('.json'));
  if (files.length === 0) return null;
  files.sort();
  return `${dir}/${files.at(-1)}`;
}

function loadProduct(slug) {
  const path = `src/content/products/${slug}.md`;
  if (!existsSync(path)) throw new Error(`No product found at ${path}`);
  const { data } = readFrontmatter(readFileSync(path, 'utf8'));
  return { slug, ...data };
}

// Best-effort: find a real amazon.com listing image for the product if the
// record doesn't already have one, and link it into the product's
// frontmatter without disturbing any hand-written multi-line fields (see
// insertFrontmatterField). Non-fatal — a missing product image just means
// ProductCallout.astro renders without one, same as today. Only runs when
// a product is actually being used in an article (called from the
// --product path below), not proactively for the whole catalog.
async function ensureProductImage(product) {
  if (product.image) return;
  try {
    console.log(`Searching amazon.com for "${product.name}"...`);
    const query = `${product.name} — ${product.shortPitch}`;
    const result = await findAmazonProductImage({ query });

    if (result.error) {
      console.warn(`  amazon.com image search skipped: ${result.error}`);
      return;
    }
    if (!result.found) {
      console.warn('  no confirmed amazon.com match found — leaving product without an image');
      return;
    }

    const imagesDir = 'src/content/products/_images';
    mkdirSync(imagesDir, { recursive: true });
    const imageFileName = `${product.slug}.${result.ext}`;
    writeFileSync(`${imagesDir}/${imageFileName}`, result.buffer);

    const productPath = `src/content/products/${product.slug}.md`;
    const raw = readFileSync(productPath, 'utf8');
    const commentLines = [
      'Image pulled from an amazon.com listing found via search — this is a real',
      'product photo, but the match is unverified. Confirm it is the exact item',
      'before applying for the affiliate program or setting affiliateStatus live.',
    ];
    if (result.matchedTitle) {
      commentLines.push(
        `Matched listing: "${result.matchedTitle}"${result.productPageUrl ? ` — ${result.productPageUrl}` : ''}`
      );
    }
    const updated = insertFrontmatterField(raw, 'image', `./_images/${imageFileName}`, {
      comment: commentLines.join('\n'),
    });
    writeFileSync(productPath, updated);
    product.image = `./_images/${imageFileName}`;
    console.log(`  saved ${imagesDir}/${imageFileName} and linked it from ${productPath}`);
    if (result.matchedTitle) console.log(`  matched amazon.com listing: "${result.matchedTitle}"`);
    console.log('  NOTE: unverified match — confirm it is the exact product before publishing.');
  } catch (err) {
    console.warn(`  product image search skipped: ${err.message}`);
  }
}

async function findSources(entry) {
  const topic = `${entry.painPoint.title} — ${entry.brief.problemSolved}`;
  console.log('Searching for authority sources to cite...');
  const { sources, error } = await searchAuthoritySources({ topic });
  if (error) {
    console.warn(`  source search skipped: ${error}`);
  } else {
    console.log(`  found ${sources.length} candidate source(s):`);
    for (const s of sources) console.log(`    - ${s.title}: ${s.url}`);
  }
  return sources;
}

// Sanity check, not a hard gate: the system prompt tells the model to only
// cite the exact URLs it was given, but a small chance of substitution
// (a similar-looking URL, a slightly different path) is exactly the
// failure mode the source-search step exists to prevent — worth a flag
// rather than trusting compliance silently.
function warnOnUnexpectedCitations(bodyMarkdown, sources) {
  const citedUrls = [...bodyMarkdown.matchAll(/\]\((https?:\/\/[^\s)]+)\)/g)].map((m) => m[1]);
  const allowedUrls = new Set(sources.map((s) => s.url));
  const unexpected = citedUrls.filter((url) => !allowedUrls.has(url));
  if (unexpected.length > 0) {
    console.warn('  WARNING: article cites URL(s) not in the found source list — verify manually before publishing:');
    for (const url of unexpected) console.warn(`    - ${url}`);
  }
}

// Category -> scene hint, so the hero photo is actually about the
// article's topic rather than one generic image for every piece.
const HERO_SCENE_HINTS = {
  Body: 'a woman mid-set in a strength workout, doing a bodyweight exercise, or in an everyday healthy-routine moment — lifting weights, a push-up or stretch, walking outside, focused and natural',
  Food: 'a woman preparing or enjoying a wholesome meal in her kitchen, natural light',
  Mind: 'a woman in a quiet, grounding moment — journaling, stretching, or sitting with a warm drink, calm and present',
  Hormones: 'a woman in a calm, everyday self-care moment — resting a hand on her stomach, sitting with tea, or a quiet moment checking in with herself, warm natural light',
  Love: 'a woman with a warm, confident expression in a candid moment — journaling, laughing with a friend, or a quiet moment of self-reflection',
  Beauty: 'a woman doing a simple skincare or self-care routine — washing her face, applying moisturizer, or a quiet bathroom-mirror moment, natural light',
  Sleep: 'a woman resting or gently stretching in a cozy setting, soft morning or evening light',
  'Life Stages': "a woman in an everyday moment that reflects where she's at in life — with a baby, mid-workout in her 40s, or simply going about her day, natural and unposed",
};

async function generateHeroImage(title, slug, category) {
  try {
    console.log('Generating hero image...');
    const sceneHint = HERO_SCENE_HINTS[category] || 'a woman in a candid, everyday moment related to the topic';
    const imagePrompt = `Editorial lifestyle photograph for a women's health and wellness article titled "${title}". Show ${sceneHint}. Candid, documentary-style composition — natural and unposed, not an overly retouched stock-photo look. Diverse in age, body type, and skin tone; avoid one narrow beauty standard. Natural, warm lighting; soft warm color grading (cream, muted plum, blush undertones) to match an editorial brand palette. Shallow depth of field for an artistic, magazine-quality feel. No visible text, logos, or watermarks in the image.`;
    const { buffer, ext } = await generatePoeImage({ prompt: imagePrompt });

    const imagesDir = 'src/content/articles/_images';
    mkdirSync(imagesDir, { recursive: true });
    const imageFileName = `${slug}-hero.${ext}`;
    writeFileSync(`${imagesDir}/${imageFileName}`, buffer);
    console.log(`  saved ${imagesDir}/${imageFileName}`);
    return { heroImage: `./_images/${imageFileName}`, heroImageAlt: `Lifestyle photo related to "${title}"` };
  } catch (err) {
    console.warn(`  hero image generation skipped: ${err.message}`);
    return {};
  }
}

// Fixed regardless of --template: Mindtivate's voice and compliance rules
// (never diet-culture/fear-based, no medical diagnoses, cite only
// verified sources, one natural product mention). A template only adds
// structural/style guidance on top of this — see article-templates.mjs.
const BASE_VOICE_PROMPT = `You are the editorial voice of Mindtivate, a fitness/nutrition/mental-health
site for women. Voice: direct, warm, non-judgmental, evidence-based, never
diet-culture or fear-based. You never give medical diagnoses. You start
from a specific problem a real person raised, explain the "why" behind it
in plain language, and if a product is provided, mention it naturally
once — you don't oversell it.

You may be given a list of verified authority sources (real URLs someone
already checked). When sources are provided, back up at least one
specific factual claim with an inline markdown link using one of those
exact URLs — never invent, alter, or guess a URL yourself. If no sources
are provided, write in general terms without any links or citations.`;

function buildSystemPrompt(template) {
  return `${BASE_VOICE_PROMPT}

${template.guidance}

Respond with strict JSON only, no prose outside the JSON, matching:
{
  "title": string,
  "description": string (max 160 chars, for SEO),
  "category": "Body" | "Food" | "Mind" | "Hormones" | "Love" | "Beauty" | "Sleep" | "Life Stages",
  "tags": string[] (2-5 short tags),
  "bodyMarkdown": string (${template.wordCountTarget} words of markdown, using ## subheadings, no title heading, no frontmatter)
}`;
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  const template = ARTICLE_TEMPLATES[args.template];
  if (!template) {
    console.error(`Unknown --template "${args.template}". Available: ${listTemplateIds().join(', ')}`);
    process.exitCode = 1;
    return;
  }

  const briefsPath = args.briefs || latestBriefsFile();
  if (!briefsPath) {
    console.error('No product-briefs file found. Run `npm run pipeline:match` first.');
    process.exitCode = 1;
    return;
  }

  const briefs = JSON.parse(readFileSync(briefsPath, 'utf8'));
  const entry = briefs[args.index];
  if (!entry) {
    console.error(`No brief at index ${args.index} in ${briefsPath} (${briefs.length} available).`);
    process.exitCode = 1;
    return;
  }

  const product = args.product ? loadProduct(args.product) : null;
  if (product) await ensureProductImage(product);

  const sources = await findSources(entry);
  const sourcesBlock = sources.length
    ? `\n\nAuthority sources you may cite (use these exact URLs as markdown links; do not invent any other URL):\n${sources
        .map((s) => `- ${s.title}: ${s.url}${s.note ? ` — ${s.note}` : ''}`)
        .join('\n')}`
    : '\n\nNo verified external sources are available this run — write in general terms and do not include any citation links or URLs.';

  const prompt = `Pain point (from r/${entry.painPoint.subreddit}): "${entry.painPoint.title}"
Detail: ${entry.painPoint.selftextExcerpt}

Product research brief: ${entry.brief.category} — ${entry.brief.searchQuery}
Problem it should solve: ${entry.brief.problemSolved}
${product ? `\nMatched product record: "${product.name}" — ${product.shortPitch}` : '\nNo specific product matched yet — write the article without a hard product recommendation.'}
${sourcesBlock}

Write the article JSON now.`;

  console.log(`Drafting article with Poe (template: ${template.label})...`);
  const draft = await askPoeForJson({ system: buildSystemPrompt(template), prompt, maxTokens: template.maxTokens });
  warnOnUnexpectedCitations(draft.bodyMarkdown, sources);

  const slug = slugify(draft.title);
  const filePath = `src/content/articles/${slug}.md`;
  if (existsSync(filePath)) {
    console.error(`Refusing to overwrite existing file: ${filePath}`);
    process.exitCode = 1;
    return;
  }

  const heroImageFields = await generateHeroImage(draft.title, slug, draft.category);

  const frontmatter = {
    title: draft.title,
    description: draft.description,
    pubDate: new Date(),
    category: draft.category,
    status: 'draft',
    draft: true,
    author: 'mindtivate-team',
    sourceSubreddit: `r/${entry.painPoint.subreddit}`,
    sourceThreadUrl: entry.painPoint.url,
    ...heroImageFields,
    ...(product ? { featuredProducts: [product.slug] } : {}),
    tags: draft.tags,
  };

  mkdirSync('src/content/articles', { recursive: true });
  writeFileSync(filePath, writeMarkdownFile({ frontmatter, body: draft.bodyMarkdown }));
  console.log(`Wrote draft: ${filePath}`);
  console.log('Status is "draft" — review in Pages CMS, verify any product/affiliate link and cited sources, then publish.');
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

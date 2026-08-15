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
//   npm run pipeline:draft -- --index 0 [--product some-product-slug] [--briefs path.json]

import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { loadEnv } from '../lib/env.mjs';
import { askPoeForJson, searchAuthoritySources, generatePoeImage } from '../lib/poe.mjs';
import { writeMarkdownFile, slugify, readFrontmatter, insertFrontmatterField } from '../lib/frontmatter.mjs';

loadEnv();

function parseArgs(argv) {
  const args = { index: 0 };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--index') args.index = Number(argv[++i]);
    else if (argv[i] === '--product') args.product = argv[++i];
    else if (argv[i] === '--briefs') args.briefs = argv[++i];
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

// Best-effort: generate a product image if the record doesn't already have
// one, and link it into the product's frontmatter without disturbing any
// hand-written multi-line fields (see insertFrontmatterField). Non-fatal —
// a missing product image just means ProductCallout.astro renders without
// one, same as today.
async function ensureProductImage(product) {
  if (product.image) return;
  try {
    console.log(`Generating product image for "${product.name}"...`);
    const imagePrompt = `Simple, clean flat-illustration style product image for the category "${product.category}": ${product.name} — ${product.shortPitch}. Neutral light background, no brand logos, no readable text, no packaging claims.`;
    const { buffer, ext } = await generatePoeImage({ prompt: imagePrompt });

    const imagesDir = 'src/content/products/_images';
    mkdirSync(imagesDir, { recursive: true });
    const imageFileName = `${product.slug}.${ext}`;
    writeFileSync(`${imagesDir}/${imageFileName}`, buffer);

    const productPath = `src/content/products/${product.slug}.md`;
    const raw = readFileSync(productPath, 'utf8');
    const updated = insertFrontmatterField(raw, 'image', `./_images/${imageFileName}`, {
      comment: 'AI-generated placeholder — replace with a real product photo before affiliateStatus goes live.',
    });
    writeFileSync(productPath, updated);
    product.image = `./_images/${imageFileName}`;
    console.log(`  saved ${imagesDir}/${imageFileName} and linked it from ${productPath}`);
    console.log('  NOTE: this is an AI-generated placeholder, not a real photo of the product —');
    console.log('  swap it for an actual product photo before affiliateStatus goes to approved/active.');
  } catch (err) {
    console.warn(`  product image generation skipped: ${err.message}`);
  }
}

async function findSources(entry) {
  const topic = `${entry.painPoint.title} — ${entry.brief.problemSolved}`;
  console.log('Searching for authority sources to cite...');
  const { sources, error } = await searchAuthoritySources({ topic });
  if (error) console.warn(`  source search skipped: ${error}`);
  else console.log(`  found ${sources.length} candidate source(s)`);
  return sources;
}

async function generateHeroImage(title, slug) {
  try {
    console.log('Generating hero image...');
    const imagePrompt = `Flat, minimalist editorial illustration for a women's fitness and wellness article titled "${title}". Warm, soft color palette (cream, plum, blush tones), simple shapes, no text, no logos, no readable words, no photorealistic faces.`;
    const { buffer, ext } = await generatePoeImage({ prompt: imagePrompt });

    const imagesDir = 'src/content/articles/_images';
    mkdirSync(imagesDir, { recursive: true });
    const imageFileName = `${slug}-hero.${ext}`;
    writeFileSync(`${imagesDir}/${imageFileName}`, buffer);
    console.log(`  saved ${imagesDir}/${imageFileName}`);
    return { heroImage: `./_images/${imageFileName}`, heroImageAlt: `Illustration for "${title}"` };
  } catch (err) {
    console.warn(`  hero image generation skipped: ${err.message}`);
    return {};
  }
}

const SYSTEM_PROMPT = `You are the editorial voice of Mindtivate, a fitness/nutrition/mental-health
site for women. Voice: direct, warm, non-judgmental, evidence-based, never
diet-culture or fear-based. You never give medical diagnoses. You start
from a specific problem a real person raised, explain the "why" behind it
in plain language, and if a product is provided, mention it naturally
once — you don't oversell it.

You may be given a list of verified authority sources (real URLs someone
already checked). When sources are provided, back up at least one
specific factual claim with an inline markdown link using one of those
exact URLs — never invent, alter, or guess a URL yourself. If no sources
are provided, write in general terms without any links or citations.

Respond with strict JSON only, no prose outside the JSON, matching:
{
  "title": string,
  "description": string (max 160 chars, for SEO),
  "category": "Weight Loss" | "Strength Training" | "Nutrition" | "Mental Health" | "Bodyweight Fitness" | "Recovery" | "Motivation",
  "tags": string[] (2-5 short tags),
  "bodyMarkdown": string (600-900 words of markdown, using ## subheadings, no title heading, no frontmatter)
}`;

async function run() {
  const args = parseArgs(process.argv.slice(2));
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

  console.log('Drafting article with Poe...');
  const draft = await askPoeForJson({ system: SYSTEM_PROMPT, prompt, maxTokens: 3000 });

  const slug = slugify(draft.title);
  const filePath = `src/content/articles/${slug}.md`;
  if (existsSync(filePath)) {
    console.error(`Refusing to overwrite existing file: ${filePath}`);
    process.exitCode = 1;
    return;
  }

  const heroImageFields = await generateHeroImage(draft.title, slug);

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

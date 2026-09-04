#!/usr/bin/env node
// Stage 10: one-off/occasional bulk backfill -- regenerates every
// existing article's hero image using the current hero-image system
// (independently-randomized scene/composition/lighting/palette/style,
// or a real Pexels/Unsplash stock photo -- see generateHeroImage in
// 3-generate-article.mjs) and saves it as WebP. Existing articles still
// carry whatever their hero image looked like when they were originally
// drafted (often PNG/JPEG, and often from the older, less-varied prompt
// system this pipeline used before); this brings them up to date without
// re-drafting the article text itself.
//
// Not part of the daily automated pipeline -- this is a manual, run-when-
// you-want-it operation (each run spends real Poe/Pexels/Unsplash API
// calls per article), so there's no scheduled workflow wired to a cron
// for it, only workflow_dispatch (see .github/workflows/
// regenerate-hero-images.yml).
//
// Usage:
//   npm run pipeline:regen-heroes                       # every article with a heroImage set
//   npm run pipeline:regen-heroes -- --limit 5
//   npm run pipeline:regen-heroes -- --slug some-article-slug   # just one article

import { existsSync, readdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { loadEnv } from '../lib/env.mjs';
import { readFrontmatter, upsertFrontmatterField, removeFrontmatterField } from '../lib/frontmatter.mjs';
import { generateHeroImage } from './3-generate-article.mjs';

loadEnv();

const ARTICLES_DIR = 'src/content/articles';
const HERO_ATTRIBUTION_FIELDS = ['heroImageSource', 'heroImagePhotographer', 'heroImagePhotographerUrl', 'heroImageSourceUrl'];

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--slug') args.slug = argv[++i];
    else if (argv[i] === '--limit') args.limit = Number(argv[++i]);
  }
  return args;
}

function listArticlesWithHeroImage() {
  return readdirSync(ARTICLES_DIR)
    .filter((f) => f.endsWith('.md'))
    .map((f) => {
      const slug = f.replace(/\.md$/, '');
      const raw = readFileSync(`${ARTICLES_DIR}/${f}`, 'utf8');
      const { data } = readFrontmatter(raw);
      return { slug, filePath: `${ARTICLES_DIR}/${f}`, raw, ...data };
    })
    .filter((a) => Boolean(a.heroImage));
}

function resolveImagePath(slug, heroImageValue) {
  return `${ARTICLES_DIR}/${heroImageValue.replace(/^\.\//, '')}`;
}

async function regenerateOne(article) {
  console.log(`\n${article.slug}`);
  const oldImagePath = resolveImagePath(article.slug, article.heroImage);

  const result = await generateHeroImage(article.title, article.slug, article.category);
  if (!result.heroImage) {
    console.warn('  regeneration failed (see warning above) -- leaving the existing hero image in place');
    return false;
  }

  const newImagePath = resolveImagePath(article.slug, result.heroImage);
  if (newImagePath !== oldImagePath && existsSync(oldImagePath)) {
    unlinkSync(oldImagePath);
    console.log(`  removed old hero image: ${oldImagePath}`);
  }

  let raw = upsertFrontmatterField(article.raw, 'heroImage', result.heroImage);
  raw = upsertFrontmatterField(raw, 'heroImageAlt', result.heroImageAlt);
  raw = upsertFrontmatterField(raw, 'updatedDate', new Date());

  // Explicitly set or clear all four attribution fields based on
  // whether this regeneration landed on a real stock photo or an
  // AI-generated one -- otherwise a stale credit from a previous run
  // could linger and point at an image that's no longer used (or vice
  // versa, a newly-stock-sourced image could ship with no attribution).
  for (const field of HERO_ATTRIBUTION_FIELDS) {
    raw = result[field] ? upsertFrontmatterField(raw, field, result[field]) : removeFrontmatterField(raw, field);
  }

  writeFileSync(article.filePath, raw);
  console.log(`  wrote new hero image and updated ${article.filePath}`);
  return true;
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  const all = listArticlesWithHeroImage();

  let targets;
  if (args.slug) {
    const target = all.find((a) => a.slug === args.slug);
    if (!target) {
      console.error(`No article with a heroImage found at slug "${args.slug}".`);
      process.exitCode = 1;
      return;
    }
    targets = [target];
  } else {
    targets = args.limit ? all.slice(0, args.limit) : all;
  }

  if (targets.length === 0) {
    console.log('No articles with a heroImage found -- nothing to do.');
    return;
  }

  console.log(`Regenerating hero images for ${targets.length} of ${all.length} article(s)...`);
  let updatedCount = 0;
  for (const article of targets) {
    try {
      if (await regenerateOne(article)) updatedCount++;
    } catch (err) {
      console.error(`  FAILED to regenerate ${article.slug}: ${err.message}`);
      console.error('  leaving this article\'s hero image as-is.');
    }
  }
  console.log(`\nDone. Regenerated ${updatedCount} of ${targets.length} article(s).`);
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

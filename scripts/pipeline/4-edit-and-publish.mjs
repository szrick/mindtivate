#!/usr/bin/env node
// Stage 4: the automated editor. Runs on a freshly-drafted article (still
// status: draft, draft: true from stage 3) and, once it's satisfied,
// flips it to status: published, draft: false -- no human review step in
// between. Four checks/fixes, each non-fatal on its own (a failure just
// leaves that one thing as stage 3 left it, logged as a warning) so one
// flaky Poe call doesn't block the rest of the run:
//
//   1. Hero image text check: asks a vision-capable Poe bot whether the
//      generated hero photo has any visible text baked into it. If so,
//      regenerates it once (reusing 3-generate-article.mjs's own
//      generateHeroImage); if it still has text, drops the hero image
//      entirely rather than ship a bad one.
//   2. External link relevance + reachability: asks Poe to flag any cited
//      source link that isn't genuinely relevant to the sentence it's
//      attached to (link removed, sentence text left as-is), then does a
//      live HTTP check on whatever's left and strips anything that
//      doesn't actually resolve.
//   3. Internal links: same "propose an exact findText -> replaceText
//      pair against a real, current list of published articles" pattern
//      as stage 9, applied inline here so an article backfilled with
//      newer context doesn't have to wait for stage 9's weekly pass.
//   4. Affiliate product match: if the article has no featuredProducts
//      yet, asks Poe whether any product with a real, live affiliate
//      link (`affiliateStatus: approved`/`active`) is a genuine, specific
//      fit -- not just same-category padding -- and attaches it if so.
//      ArticleLayout/ProductCallout already render the "Check current
//      price" affiliate link automatically once featuredProducts is set.
//
// If any single article throws partway through, nothing is written for
// it -- every mutation happens in memory and the file is only written
// once, at the very end -- so it's left exactly as stage 3 drafted it
// (still status: draft) for manual attention, rather than landing with a
// half-applied edit.
//
// Usage:
//   npm run pipeline:edit                    # every newly-drafted (git-untracked)
//                                             # article under src/content/articles
//   npm run pipeline:edit -- --slug some-article-slug   # just one article

import { existsSync, readFileSync, writeFileSync, unlinkSync, readdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { loadEnv } from '../lib/env.mjs';
import { askPoeForJson } from '../lib/poe.mjs';
import {
  readFrontmatter,
  upsertFrontmatterField,
  insertFrontmatterField,
  removeFrontmatterField,
  replaceArticleBody,
} from '../lib/frontmatter.mjs';
import { generateHeroImage } from './3-generate-article.mjs';

loadEnv();

const ARTICLES_DIR = 'src/content/articles';
const PRODUCTS_DIR = 'src/content/products';
const USER_AGENT = 'Mozilla/5.0 (compatible; MindtivateEditorBot/1.0; +https://mindtivate.com)';
// Same "0-2 is normal, more reads as SEO padding" norm stage 3 and stage
// 9 both use.
const MAX_INTERNAL_LINKS = 2;

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--slug') args.slug = argv[++i];
  }
  return args;
}

// Freshly-drafted articles are untracked in git until this run's own
// commit step -- reusing that as the "what did we just draft this run"
// signal means there's no separate state file to keep in sync, and it
// naturally leaves alone any draft a human is mid-editing in Pages CMS
// (which, being already committed to main, never shows as untracked).
function discoverNewDraftFiles() {
  let output;
  try {
    output = execSync(`git status --porcelain -- ${ARTICLES_DIR}`, { encoding: 'utf8' });
  } catch (err) {
    console.warn(`git status failed (${err.message}) -- pass --slug to target a specific article instead.`);
    return [];
  }
  return output
    .split('\n')
    .filter((line) => line.startsWith('??'))
    .map((line) => line.slice(3).trim())
    .filter((f) => f.endsWith('.md'));
}

function listPublishedArticles() {
  if (!existsSync(ARTICLES_DIR)) return [];
  return readdirSync(ARTICLES_DIR)
    .filter((f) => f.endsWith('.md'))
    .map((f) => {
      const { data } = readFrontmatter(readFileSync(`${ARTICLES_DIR}/${f}`, 'utf8'));
      return { slug: f.replace(/\.md$/, ''), ...data };
    })
    .filter((a) => a.status === 'published' && a.draft === false);
}

function listActiveProducts() {
  if (!existsSync(PRODUCTS_DIR)) return [];
  return readdirSync(PRODUCTS_DIR)
    .filter((f) => f.endsWith('.md'))
    .map((f) => {
      const { data } = readFrontmatter(readFileSync(`${PRODUCTS_DIR}/${f}`, 'utf8'));
      return { slug: f.replace(/\.md$/, ''), ...data };
    })
    .filter((p) => ['approved', 'active'].includes(p.affiliateStatus) && p.affiliateUrl);
}

// featuredProducts is a nested list -- readFrontmatter's minimal parser
// deliberately leaves those as raw strings (see frontmatter.mjs), so this
// checks the raw frontmatter text directly rather than trusting the
// parsed field.
function hasFeaturedProduct(raw) {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return false;
  const line = match[1].split(/\r?\n/).find((l) => l.trim().startsWith('featuredProducts:'));
  if (!line) return false;
  return line.trim() !== 'featuredProducts: []';
}

function resolveImagePath(articleFilePath, heroImageValue) {
  const dir = articleFilePath.split('/').slice(0, -1).join('/');
  return `${dir}/${heroImageValue.replace(/^\.\//, '')}`;
}

const IMAGE_TEXT_CHECK_SYSTEM_PROMPT = `You are a strict image QA reviewer for a health/wellness editorial site.
You are shown one photograph that is meant to be a clean, text-free
lifestyle photo -- no title, caption, logo, watermark, or any other
typography baked into the image itself. Look carefully at the whole
image, including corners, overlays, clothing, signage, and small
background details.

Respond with strict JSON only, no prose outside the JSON:
{"hasText": boolean, "details": string}
Set "details" to a short description of what text you found (or "none"
if hasText is false).`;

async function imagePassesTextCheck(imagePath) {
  if (!existsSync(imagePath)) return true; // nothing to check, don't block on it
  const ext = imagePath.split('.').pop().toLowerCase();
  const mimeType = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
  const base64 = readFileSync(imagePath).toString('base64');

  try {
    const result = await askPoeForJson({
      system: IMAGE_TEXT_CHECK_SYSTEM_PROMPT,
      prompt:
        'Does this image contain any visible text, words, letters, numbers, captions, titles, logos, or watermarks anywhere in it?',
      images: [{ base64, mimeType }],
      maxTokens: 300,
      model: process.env.POE_VISION_MODEL,
    });
    if (result?.hasText) {
      console.warn(`    image text check: text detected -- ${result.details || 'no details given'}`);
      return false;
    }
    return true;
  } catch (err) {
    console.warn(`    image text check failed (${err.message}) -- leaving the image as-is`);
    return true; // fail open: a QA-check failure shouldn't block publishing
  }
}

// Regenerates the hero image once (reusing 3-generate-article.mjs's own
// category-based scene hints/ethnicity rotation) if it fails the text
// check, and drops the hero image entirely if the regenerated one still
// has text -- an article with no hero image is a normal, supported state
// (ArticleLayout renders around it); one with visible AI-generated text
// baked in is not something to ship.
async function reviewHeroImage(raw, data, slug) {
  if (!data.heroImage) return raw;

  const imagePath = resolveImagePath(`${ARTICLES_DIR}/${slug}.md`, data.heroImage);
  console.log('  checking hero image for visible text...');
  if (await imagePassesTextCheck(imagePath)) {
    console.log('  hero image OK -- no visible text detected');
    return raw;
  }

  console.warn('  regenerating hero image once...');
  const regenerated = await generateHeroImage(data.title, slug, data.category);
  if (!regenerated.heroImage) {
    console.warn('  hero image regeneration failed -- removing hero image for this article');
    if (existsSync(imagePath)) unlinkSync(imagePath);
    return removeFrontmatterField(removeFrontmatterField(raw, 'heroImage'), 'heroImageAlt');
  }

  const newImagePath = resolveImagePath(`${ARTICLES_DIR}/${slug}.md`, regenerated.heroImage);
  const clean = await imagePassesTextCheck(newImagePath);
  if (newImagePath !== imagePath && existsSync(imagePath)) unlinkSync(imagePath);

  if (!clean) {
    console.warn('  regenerated hero image still has visible text -- removing hero image for this article');
    if (existsSync(newImagePath)) unlinkSync(newImagePath);
    return removeFrontmatterField(removeFrontmatterField(raw, 'heroImage'), 'heroImageAlt');
  }

  let updated = upsertFrontmatterField(raw, 'heroImage', regenerated.heroImage);
  updated = upsertFrontmatterField(updated, 'heroImageAlt', regenerated.heroImageAlt);
  console.log('  hero image regenerated and passed the text check');
  return updated;
}

function extractExternalLinks(body) {
  return [...new Set([...body.matchAll(/\]\((https?:\/\/[^\s)]+)\)/g)].map((m) => m[1]))];
}

function existingInternalLinkCount(body) {
  return new Set([...body.matchAll(/\]\(\/articles\/([a-z0-9-]+)\/?\)/g)].map((m) => m[1])).size;
}

function stripExternalLink(body, url) {
  const escaped = url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return body.replace(new RegExp(`\\[([^\\]]+)\\]\\(${escaped}\\)`, 'g'), '$1');
}

const EDITOR_SYSTEM_PROMPT = `You are the final editor for Mindtivate, a fitness/nutrition/mental-health
site for women, reviewing an already-drafted article before it goes live.
Two jobs, both conservative -- when in doubt, leave things as they are:

1. EXTERNAL LINK RELEVANCE: You'll see the article's markdown body and a
list of every external (https://) link currently in it. For any link
that is NOT clearly relevant to the specific point it's attached to --
not just tangentially related -- flag it for removal. Removing a link
means the surrounding sentence stays exactly as-is, just without the
hyperlink; never rewrite or remove the sentence itself. Most well-drafted
articles will have zero links worth removing.

2. INTERNAL LINKS: You'll also see a list of Mindtivate's own other
published articles. Where one is genuinely relevant to a specific point
already made in the body -- not just topically adjacent -- propose adding
one inline markdown link there. "findText" must be an exact, verbatim
substring of the body (a full sentence or clear phrase, containing no
existing link) -- it will be located with a literal string match, not
fuzzy matching. "replaceText" is that same text with a natural markdown
link ("[anchor text](/articles/<slug>/)") woven in, changing as little
else as possible. Anchor text must describe what's being linked, never
"click here" or "this article." Don't force it -- most articles need 0-2
additions, not more.

Respond with strict JSON only, no prose outside the JSON:
{"removeExternalLinks": [{"url": string, "reason": string}],
 "internalLinkAdditions": [{"slug": string, "findText": string, "replaceText": string}]}`;

async function reviewLinks({ title, category, body, slug }) {
  const externalLinks = extractExternalLinks(body);
  const internalCount = existingInternalLinkCount(body);
  const remainingInternalSlots = Math.max(0, MAX_INTERNAL_LINKS - internalCount);
  const candidates = listPublishedArticles().filter((a) => a.slug !== slug);

  if (externalLinks.length === 0 && (remainingInternalSlots === 0 || candidates.length === 0)) {
    console.log('  no external links to review and no internal-link room -- skipping link review');
    return body;
  }

  const prompt = `Article title: "${title}" (category: ${category})

Article body:
${body}

Current external links in this article:
${externalLinks.length ? externalLinks.map((u) => `- ${u}`).join('\n') : 'None.'}

Mindtivate's other published articles you may link to (up to ${remainingInternalSlots} more internal link(s) allowed):
${candidates.length ? candidates.map((a) => `- "${a.title}" (slug: ${a.slug}) -- ${a.description}`).join('\n') : 'None available yet.'}`;

  let result;
  try {
    result = await askPoeForJson({ system: EDITOR_SYSTEM_PROMPT, prompt, maxTokens: 2000 });
  } catch (err) {
    console.warn(`  link review skipped (Poe error): ${err.message}`);
    return body;
  }

  let updated = body;
  for (const removal of Array.isArray(result?.removeExternalLinks) ? result.removeExternalLinks : []) {
    if (!removal?.url || !externalLinks.includes(removal.url)) continue;
    updated = stripExternalLink(updated, removal.url);
    console.log(`  - removed irrelevant external link: ${removal.url}${removal.reason ? ` (${removal.reason})` : ''}`);
  }

  const candidateSlugs = new Set(candidates.map((a) => a.slug));
  const additions = (Array.isArray(result?.internalLinkAdditions) ? result.internalLinkAdditions : []).slice(
    0,
    remainingInternalSlots
  );
  for (const addition of additions) {
    if (!addition?.slug || !addition?.findText || !addition?.replaceText) continue;
    if (!candidateSlugs.has(addition.slug)) {
      console.warn(`  skipping suggested internal link to unlisted slug "${addition.slug}"`);
      continue;
    }
    const occurrences = updated.split(addition.findText).length - 1;
    if (occurrences !== 1) {
      console.warn(`  skipping internal link addition -- findText matched ${occurrences} time(s), expected exactly 1`);
      continue;
    }
    updated = updated.replace(addition.findText, addition.replaceText);
    console.log(`  + added internal link to /articles/${addition.slug}/`);
  }

  return updated;
}

// Live reachability sweep, independent of the LLM relevance pass above --
// catches a link that's genuinely dead (moved, taken down, a transient
// typo) regardless of whether the model thought it looked relevant. Some
// sites 403/405 a HEAD request from an unfamiliar client, so a non-2xx
// HEAD gets one GET retry before being treated as actually broken.
async function urlIsReachable(url) {
  const headers = { 'User-Agent': USER_AGENT };
  try {
    let res = await fetch(url, { method: 'HEAD', redirect: 'follow', headers, signal: AbortSignal.timeout(8000) });
    if (!res.ok && [403, 405, 501].includes(res.status)) {
      res = await fetch(url, { method: 'GET', redirect: 'follow', headers, signal: AbortSignal.timeout(8000) });
    }
    return res.ok;
  } catch {
    return false;
  }
}

async function stripDeadExternalLinks(body) {
  let updated = body;
  for (const url of extractExternalLinks(body)) {
    if (!(await urlIsReachable(url))) {
      console.warn(`  - removed unreachable external link: ${url}`);
      updated = stripExternalLink(updated, url);
    }
  }
  return updated;
}

const AFFILIATE_MATCH_SYSTEM_PROMPT = `You help decide whether to feature a real, already-vetted affiliate
product inside a Mindtivate article. You'll get the article and a list of
real products that already have an approved, live affiliate link. Pick at
most one that is genuinely, specifically relevant to this article's
actual topic -- not just the same broad category (e.g. "any supplement"
is not a match for a sleep article unless it's specifically a sleep
supplement). If nothing on the list is a real, specific fit, return null
rather than force one in. Never invent a product that isn't on the list.

Respond with strict JSON only:
{"slug": string | null, "reason": string}`;

async function matchAffiliateProduct({ title, description, category, body }) {
  const products = listActiveProducts();
  if (products.length === 0) return null;

  const productList = products
    .map(
      (p) =>
        `- "${p.name}" (slug: ${p.slug}, category: ${p.category}) -- ${p.shortPitch}${p.problemSolved ? ` | solves: ${p.problemSolved}` : ''}`
    )
    .join('\n');
  const prompt = `Article title: "${title}"
Category: ${category}
Description: ${description}

Article body:
${body}

Available products with a live affiliate link:
${productList}`;

  let result;
  try {
    result = await askPoeForJson({ system: AFFILIATE_MATCH_SYSTEM_PROMPT, prompt, maxTokens: 300 });
  } catch (err) {
    console.warn(`  affiliate product match skipped (Poe error): ${err.message}`);
    return null;
  }
  if (!result?.slug) return null;
  const match = products.find((p) => p.slug === result.slug);
  if (!match) {
    console.warn(`  skipping suggested product "${result.slug}" -- not in the known active-product list`);
    return null;
  }
  return match.slug;
}

async function processDraftArticle(filePath) {
  console.log(`\n${filePath}`);
  const originalRaw = readFileSync(filePath, 'utf8');
  const { data, body: originalBody } = readFrontmatter(originalRaw);
  const slug = filePath.split('/').pop().replace(/\.md$/, '');

  let raw = await reviewHeroImage(originalRaw, data, slug);

  console.log('  reviewing external/internal links...');
  let body = await reviewLinks({ title: data.title, category: data.category, body: originalBody, slug });
  body = await stripDeadExternalLinks(body);

  if (!hasFeaturedProduct(raw)) {
    console.log('  checking for a relevant affiliate product...');
    const matchedSlug = await matchAffiliateProduct({
      title: data.title,
      description: data.description,
      category: data.category,
      body,
    });
    if (matchedSlug) {
      raw = insertFrontmatterField(raw, 'featuredProducts', [matchedSlug]);
      console.log(`  attached affiliate product: ${matchedSlug}`);
    } else {
      console.log('  no genuinely relevant affiliate product found -- leaving unset');
    }
  }

  raw = replaceArticleBody(raw, body);
  raw = upsertFrontmatterField(raw, 'status', 'published');
  raw = upsertFrontmatterField(raw, 'draft', false);

  writeFileSync(filePath, raw);
  console.log(`  published: ${filePath}`);
}

async function run() {
  const args = parseArgs(process.argv.slice(2));

  let targets;
  if (args.slug) {
    const filePath = `${ARTICLES_DIR}/${args.slug}.md`;
    if (!existsSync(filePath)) {
      console.error(`No article found at ${filePath}`);
      process.exitCode = 1;
      return;
    }
    targets = [filePath];
  } else {
    targets = discoverNewDraftFiles();
    if (targets.length === 0) {
      console.log('No newly-drafted articles found (nothing untracked under src/content/articles) -- nothing to do.');
      return;
    }
  }

  console.log(`Editing and publishing ${targets.length} article(s)...`);
  let publishedCount = 0;
  for (const filePath of targets) {
    try {
      await processDraftArticle(filePath);
      publishedCount++;
    } catch (err) {
      console.error(`  FAILED to process ${filePath}: ${err.message}`);
      console.error('  leaving this article as-is (still draft) for manual attention.');
    }
  }
  console.log(`\nDone. Published ${publishedCount} of ${targets.length} article(s).`);
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

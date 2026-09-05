#!/usr/bin/env node
// Stage 2: turn each researched pain point into a product brief — a
// category and search query — then try to resolve it into a real,
// already-approved-affiliate-link product automatically via CJ Affiliate
// (scripts/lib/cj.mjs), before falling back to a human research step.
//
// CJ's Product Search API only ever returns products from advertisers
// this CJ account has already joined and been approved for — there's no
// API to join a *new* advertiser program, that's a human decision made
// in CJ's own dashboard, and approval is the advertiser's call. So:
//   - Brief resolves against an already-joined CJ advertiser -> a real
//     product record is created automatically (affiliateStatus: active,
//     a real tracked affiliateUrl) with no further human step needed.
//   - No already-joined CJ advertiser matches -> same as before CJ
//     existed: the brief is written out for manual research (Amazon
//     Associates, ShareASale, a direct brand program, applying to a new
//     CJ advertiser, etc.), plus a short list of CJ advertisers in the
//     network worth considering (see scripts/pipeline/output/cj-advertisers-to-join.json).
//
// Usage: npm run pipeline:match [path-to-research.json]

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { loadEnv } from '../lib/env.mjs';
import { askPoeForJson, downloadImage } from '../lib/poe.mjs';
import { searchCJProducts, findAdvertiserCandidates } from '../lib/cj.mjs';
import { slugify, writeMarkdownFile, insertFrontmatterField } from '../lib/frontmatter.mjs';

loadEnv();

const PRODUCTS_DIR = 'src/content/products';
const ADVERTISERS_TO_JOIN_PATH = 'scripts/pipeline/output/cj-advertisers-to-join.json';

function latestResearchFile() {
  const dir = 'scripts/pipeline/output';
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir).filter((f) => f.startsWith('research-') && f.endsWith('.json'));
  if (files.length === 0) return null;
  files.sort();
  return `${dir}/${files.at(-1)}`;
}

const SYSTEM_PROMPT = `You help a women's fitness/wellness editorial team turn a Reddit pain
point into a product research brief. You never invent a specific brand,
model, or purchase link — you only suggest a product category and a
concrete search query a researcher can use to find and vet a real product.
Respond with strict JSON only, no prose, matching this shape:
{"category": "Equipment" | "Apparel" | "Supplement" | "App / Program" | "Book" | "Wearable",
 "searchQuery": string,
 "problemSolved": string,
 "rationale": string}`;

async function briefFor(painPoint) {
  const prompt = `Reddit pain point from r/${painPoint.subreddit}:\nTitle: ${painPoint.title}\nDetail: ${painPoint.selftextExcerpt}\n\nProduce the JSON brief.`;
  return askPoeForJson({ system: SYSTEM_PROMPT, prompt, maxTokens: 400 });
}

// Identity check for dedup: has some existing product record already
// been created from this exact CJ tracked link? A plain substring check
// on the raw file is enough here — affiliateUrl is a distinctive URL,
// not something that would appear incidentally elsewhere in a product
// record — and avoids creating a near-duplicate product every time a
// similar brief resolves to the same top CJ match.
function findExistingProductByAffiliateUrl(affiliateUrl) {
  if (!existsSync(PRODUCTS_DIR)) return null;
  for (const file of readdirSync(PRODUCTS_DIR).filter((f) => f.endsWith('.md'))) {
    const raw = readFileSync(`${PRODUCTS_DIR}/${file}`, 'utf8');
    if (raw.includes(affiliateUrl)) return file.replace(/\.md$/, '');
  }
  return null;
}

function uniqueProductSlug(baseSlug) {
  let slug = baseSlug;
  let n = 2;
  while (existsSync(`${PRODUCTS_DIR}/${slug}.md`)) slug = `${baseSlug}-${n++}`;
  return slug;
}

// Best-effort: pulls the CJ listing's own product image so the record
// isn't left without one. Non-fatal — a failed download just means
// ProductCallout.astro renders without an image, same as any other
// product record that never got one.
async function attachCjProductImage(slug, imageLink) {
  if (!imageLink) return;
  try {
    const { buffer, ext } = await downloadImage(imageLink);
    const imagesDir = `${PRODUCTS_DIR}/_images`;
    mkdirSync(imagesDir, { recursive: true });
    const imageFileName = `${slug}.${ext}`;
    writeFileSync(`${imagesDir}/${imageFileName}`, buffer);

    const productPath = `${PRODUCTS_DIR}/${slug}.md`;
    const raw = readFileSync(productPath, 'utf8');
    writeFileSync(productPath, insertFrontmatterField(raw, 'image', `./_images/${imageFileName}`));
    console.log(`    saved product image ${imagesDir}/${imageFileName}`);
  } catch (err) {
    console.warn(`    CJ product image download skipped: ${err.message}`);
  }
}

// Turns a confirmed CJ match into a real product record: real name, real
// already-tracked affiliate link, affiliateStatus: active from the start
// — unlike the Amazon-image-search path elsewhere in this pipeline,
// there's no "unverified match, confirm before going live" caveat here,
// because CJ's Product Search API only returns products from advertiser
// programs this account is already approved for, and the link it returns
// is CJ's own tracked link for that exact account, not a scraped one.
async function createCjProductRecord(brief, match) {
  const existingSlug = findExistingProductByAffiliateUrl(match.link);
  if (existingSlug) {
    console.log(`    already have a product for this CJ match (${existingSlug}) — reusing it`);
    return { slug: existingSlug, name: match.title };
  }

  const slug = uniqueProductSlug(slugify(match.title) || slugify(brief.searchQuery));
  const frontmatter = {
    name: match.title,
    category: brief.category,
    shortPitch: brief.problemSolved,
    affiliateProgram: 'CJ Affiliate',
    affiliateStatus: 'active',
    affiliateUrl: match.link,
    disclosureRequired: true,
    problemSolved: brief.problemSolved,
  };
  const body = [
    'Sourced automatically via the CJ Affiliate Product Search API',
    `(advertiser: ${match.advertiserName || 'unknown'}).`,
    match.description || '',
  ]
    .filter(Boolean)
    .join(' ');

  mkdirSync(PRODUCTS_DIR, { recursive: true });
  writeFileSync(`${PRODUCTS_DIR}/${slug}.md`, writeMarkdownFile({ frontmatter, body }));
  console.log(`    created ${PRODUCTS_DIR}/${slug}.md from CJ advertiser "${match.advertiserName}"`);

  await attachCjProductImage(slug, match.imageLink);

  return { slug, name: match.title };
}

// Non-fatal, best-effort: when no already-joined advertiser matches,
// note a few advertisers in CJ's wider network that do, so applying to
// join one is a lookup away instead of a blind search. Accumulates into
// one file across runs rather than a new timestamped file per run, since
// this is meant to be skimmed occasionally, not diffed run-to-run.
async function noteAdvertiserCandidates(brief) {
  try {
    const candidates = await findAdvertiserCandidates(brief.searchQuery);
    if (candidates.length === 0) return;

    mkdirSync('scripts/pipeline/output', { recursive: true });
    let existing = [];
    if (existsSync(ADVERTISERS_TO_JOIN_PATH)) {
      try {
        existing = JSON.parse(readFileSync(ADVERTISERS_TO_JOIN_PATH, 'utf8'));
      } catch {
        existing = [];
      }
    }
    existing.push({
      notedAt: new Date().toISOString(),
      searchQuery: brief.searchQuery,
      category: brief.category,
      candidateAdvertisers: candidates,
    });
    writeFileSync(ADVERTISERS_TO_JOIN_PATH, JSON.stringify(existing, null, 2));
    console.log(
      `    no already-joined CJ advertiser matched — noted ${candidates.length} candidate(s) in ${ADVERTISERS_TO_JOIN_PATH}`,
    );
  } catch (err) {
    console.warn(`    CJ advertiser candidate lookup skipped: ${err.message}`);
  }
}

// Tries to resolve a brief into a real product automatically via CJ.
// Returns { slug, name } on success, or null if CJ isn't configured, has
// no already-joined-advertiser match, or the lookup failed — any of
// which just means this brief falls back to the pre-CJ manual-research
// path, same as before this integration existed.
async function tryCjSourcing(brief) {
  const match = await searchCJProducts(brief.searchQuery);
  if (!match) {
    await noteAdvertiserCandidates(brief);
    return null;
  }
  return createCjProductRecord(brief, match);
}

async function run() {
  const inputPath = process.argv[2] || latestResearchFile();
  if (!inputPath) {
    console.error('No research file found. Run `npm run pipeline:research` first.');
    process.exitCode = 1;
    return;
  }

  const painPoints = JSON.parse(readFileSync(inputPath, 'utf8'));
  console.log(`Matching ${painPoints.length} pain points from ${inputPath}...`);

  const cjConfigured = Boolean(process.env.CJ_PERSONAL_ACCESS_TOKEN && process.env.CJ_COMPANY_ID);

  const briefs = [];
  for (const painPoint of painPoints) {
    try {
      const brief = await briefFor(painPoint);
      console.log(`  [${painPoint.subreddit}] "${painPoint.title.slice(0, 60)}..." -> ${brief.category}: ${brief.searchQuery}`);

      const cjProduct = cjConfigured ? await tryCjSourcing(brief) : null;
      if (cjProduct) {
        console.log(`    resolved automatically via CJ: "${cjProduct.name}" (${cjProduct.slug})`);
      }

      briefs.push({ painPoint, brief, ...(cjProduct ? { cjProduct } : {}) });
    } catch (err) {
      console.warn(`  skipped (Poe error): ${painPoint.title.slice(0, 60)}... — ${err.message}`);
    }
  }

  mkdirSync('scripts/pipeline/output', { recursive: true });
  const outPath = `scripts/pipeline/output/product-briefs-${Date.now()}.json`;
  writeFileSync(outPath, JSON.stringify(briefs, null, 2));
  console.log(`\nWrote ${briefs.length} product briefs to ${outPath}`);

  const resolvedCount = briefs.filter((b) => b.cjProduct).length;
  if (resolvedCount > 0) {
    console.log(`${resolvedCount} of them were resolved into a real product automatically via CJ.`);
  }
  if (!cjConfigured) {
    console.log('CJ_PERSONAL_ACCESS_TOKEN / CJ_COMPANY_ID not set — CJ auto-sourcing skipped for all briefs.');
  }
  console.log('Next, for any brief without a cjProduct: research it, apply for the relevant');
  console.log('affiliate program, then add/update a product record in src/content/products/');
  console.log('(via Pages CMS or git) with affiliateStatus and affiliateUrl once approved.');
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

#!/usr/bin/env node
// Stage 3: draft an article from a researched pain point (+ optional
// matched product) using Claude. Always writes with status: draft,
// draft: true — nothing this script produces is publishable until a human
// reviews it (in Pages CMS or a PR) and flips status to published.
//
// Usage:
//   npm run pipeline:draft -- --index 0 [--product some-product-slug] [--briefs path.json]

import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { loadEnv } from '../lib/env.mjs';
import { askClaudeForJson } from '../lib/claude.mjs';
import { writeMarkdownFile, slugify, readFrontmatter } from '../lib/frontmatter.mjs';

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

const SYSTEM_PROMPT = `You are the editorial voice of Mindtivate, a fitness/nutrition/mental-health
site for women. Voice: direct, warm, non-judgmental, evidence-based, never
diet-culture or fear-based. You never give medical diagnoses. You start
from a specific problem a real person raised, explain the "why" behind it
in plain language, and if a product is provided, mention it naturally
once — you don't oversell it.

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

  const prompt = `Pain point (from r/${entry.painPoint.subreddit}): "${entry.painPoint.title}"
Detail: ${entry.painPoint.selftextExcerpt}

Product research brief: ${entry.brief.category} — ${entry.brief.searchQuery}
Problem it should solve: ${entry.brief.problemSolved}
${product ? `\nMatched product record: "${product.name}" — ${product.shortPitch}` : '\nNo specific product matched yet — write the article without a hard product recommendation.'}

Write the article JSON now.`;

  console.log('Drafting article with Claude...');
  const draft = await askClaudeForJson({ system: SYSTEM_PROMPT, prompt, maxTokens: 3000 });

  const slug = slugify(draft.title);
  const filePath = `src/content/articles/${slug}.md`;
  if (existsSync(filePath)) {
    console.error(`Refusing to overwrite existing file: ${filePath}`);
    process.exitCode = 1;
    return;
  }

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
    ...(product ? { featuredProducts: [product.slug] } : {}),
    tags: draft.tags,
  };

  mkdirSync('src/content/articles', { recursive: true });
  writeFileSync(filePath, writeMarkdownFile({ frontmatter, body: draft.bodyMarkdown }));
  console.log(`Wrote draft: ${filePath}`);
  console.log('Status is "draft" — review in Pages CMS, verify any product/affiliate link, then publish.');
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

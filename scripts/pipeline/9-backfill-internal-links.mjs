#!/usr/bin/env node
// Stage 9: backfill internal links into already-published articles as
// newer, genuinely relevant articles appear after them. Stage 3 only
// offers internal-link candidates that existed at draft time, so an
// article written early on (when there was little else to link to) can
// stay under-linked indefinitely without something like this.
//
// Runs unattended on a schedule (weekly-internal-links.yml), which opens
// a PR with the resulting diffs -- review means reading the changed
// sentences right in the PR, same as every other scheduled drafting step
// in this pipeline. Nothing merges automatically, and nothing here
// touches already-published content until a human approves the PR.
//
// Usage:
//   npm run pipeline:relink                       # up to 5 oldest under-linked articles
//   npm run pipeline:relink -- --limit 10
//   npm run pipeline:relink -- --slug some-article-slug   # just one article

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { loadEnv } from '../lib/env.mjs';
import { askPoeForJson } from '../lib/poe.mjs';
import { readFrontmatter, upsertFrontmatterField, replaceArticleBody } from '../lib/frontmatter.mjs';

loadEnv();

const ARTICLES_DIR = 'src/content/articles';
// Matches stage 3's own norm ("0-2 internal links in a piece is normal;
// stuffing one in every section reads as SEO padding") -- articles at or
// above this are left alone rather than pushed for more.
const MAX_EXISTING_LINKS = 2;
const DEFAULT_LIMIT = 5;

const SYSTEM_PROMPT = `You add internal links to an already-published article on Mindtivate, a
fitness/nutrition/mental-health site for women, by pointing to OTHER
articles on the same site that genuinely deserve a mention.

You will be given the article's full text and a list of Mindtivate's own
other published articles (title, slug, description). For each one that is
genuinely relevant to a specific point already made in the text -- not
just topically adjacent -- propose adding one inline markdown link there.
Do not force it: if nothing on the list is a real fit, return an empty
list. 0-2 additions is normal; a link for every candidate is not real
editing, it's SEO padding, and you should not do that.

For every addition:
- "slug" must be copied exactly from the list -- never invent one.
- "findText" must be an exact, verbatim substring of the article text as
  given to you (a full sentence or clear phrase works well) that does NOT
  already contain a markdown link. Copy it character-for-character -- it
  will be located with a literal string match, not fuzzy matching.
- "replaceText" is that same text with a natural markdown link
  ("[anchor text](/articles/<slug>/)") woven in -- change as little else
  as possible, and never invent facts or claims that weren't already
  there. Anchor text should describe what the link is about, never "click
  here" or "this article".

Respond with strict JSON only, no prose outside the JSON:
{"additions": [{"slug": string, "findText": string, "replaceText": string}]}`;

function parseArgs(argv) {
  const args = { limit: DEFAULT_LIMIT };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--slug') args.slug = argv[++i];
    else if (argv[i] === '--limit') args.limit = Number(argv[++i]);
  }
  return args;
}

function listPublishedArticles() {
  return readdirSync(ARTICLES_DIR)
    .filter((f) => f.endsWith('.md'))
    .map((f) => {
      const raw = readFileSync(`${ARTICLES_DIR}/${f}`, 'utf8');
      const { data, body } = readFrontmatter(raw);
      return { slug: f.replace(/\.md$/, ''), raw, body, ...data };
    })
    .filter((a) => a.status === 'published' && a.draft === false);
}

function existingLinkedSlugs(body) {
  const slugs = new Set();
  for (const m of body.matchAll(/\]\(\/articles\/([a-z0-9-]+)\/?\)/g)) {
    slugs.add(m[1]);
  }
  return slugs;
}

async function processArticle(article, allArticles) {
  const alreadyLinked = existingLinkedSlugs(article.body);
  const candidates = allArticles.filter((a) => a.slug !== article.slug && !alreadyLinked.has(a.slug));
  if (candidates.length === 0) {
    console.log('  no candidate articles to link to -- skipping');
    return false;
  }

  const candidateList = candidates.map((a) => `- "${a.title}" (slug: ${a.slug}) -- ${a.description}`).join('\n');
  const prompt = `Article title: "${article.title}"\n\nArticle text:\n${article.body}\n\nOther published articles you may link to:\n${candidateList}`;

  let result;
  try {
    result = await askPoeForJson({ system: SYSTEM_PROMPT, prompt, maxTokens: 2000 });
  } catch (err) {
    console.warn(`  Poe request failed: ${err.message} -- skipping`);
    return false;
  }

  const additions = Array.isArray(result?.additions) ? result.additions.slice(0, 2) : [];
  if (additions.length === 0) {
    console.log('  no genuinely relevant links suggested -- skipping');
    return false;
  }

  const candidateSlugs = new Set(candidates.map((a) => a.slug));
  let body = article.body;
  let applied = 0;
  for (const addition of additions) {
    if (!addition?.slug || !addition?.findText || !addition?.replaceText) continue;
    if (!candidateSlugs.has(addition.slug)) {
      console.warn(`  skipping suggested link to unlisted slug "${addition.slug}"`);
      continue;
    }
    const occurrences = body.split(addition.findText).length - 1;
    if (occurrences !== 1) {
      console.warn(`  skipping addition -- findText matched ${occurrences} time(s) in the body, expected exactly 1`);
      continue;
    }
    body = body.replace(addition.findText, addition.replaceText);
    applied++;
    console.log(`  + linked to /articles/${addition.slug}/`);
  }

  if (applied === 0) return false;

  let raw = upsertFrontmatterField(article.raw, 'updatedDate', new Date());
  raw = replaceArticleBody(raw, body);
  writeFileSync(`${ARTICLES_DIR}/${article.slug}.md`, raw);
  console.log(`  wrote ${applied} new internal link(s) to ${article.slug}.md`);
  return true;
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  const allArticles = listPublishedArticles();

  let targets;
  if (args.slug) {
    const target = allArticles.find((a) => a.slug === args.slug);
    if (!target) {
      console.error(`No published article found at slug "${args.slug}".`);
      process.exitCode = 1;
      return;
    }
    targets = [target];
  } else {
    // Oldest first: an article published early on had the fewest other
    // articles to link to at the time, so it's the most likely to still
    // be under-linked now.
    targets = allArticles
      .filter((a) => existingLinkedSlugs(a.body).size < MAX_EXISTING_LINKS)
      .sort((a, b) => new Date(a.pubDate) - new Date(b.pubDate))
      .slice(0, args.limit);
  }

  if (targets.length === 0) {
    console.log('No under-linked published articles found -- nothing to do.');
    return;
  }

  console.log(`Processing ${targets.length} article(s)...`);
  let updatedCount = 0;
  for (const article of targets) {
    console.log(`\n${article.slug}`);
    if (await processArticle(article, allArticles)) updatedCount++;
  }
  console.log(`\nDone. Updated ${updatedCount} of ${targets.length} article(s).`);
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

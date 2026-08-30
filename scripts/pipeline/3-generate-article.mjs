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

// Real internal link candidates: only articles actually live on the
// site (status: published, draft: false) — a link to a draft could
// point at something that never ends up published, or isn't live yet.
function listPublishedArticles() {
  const dir = 'src/content/articles';
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .map((f) => {
      const { data } = readFrontmatter(readFileSync(`${dir}/${f}`, 'utf8'));
      return { slug: f.replace(/\.md$/, ''), ...data };
    })
    .filter((a) => a.status === 'published' && a.draft === false);
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

// Same non-fatal spirit as warnOnUnexpectedCitations: the system prompt
// tells the model to only link to articles from the given list, this
// flags anything that slipped through (a plausible-sounding slug the
// model guessed at, or a stale one), so a dangling internal link doesn't
// silently ship.
function warnOnUnexpectedInternalLinks(bodyMarkdown, articles) {
  const linkedSlugs = [...bodyMarkdown.matchAll(/\]\(\/articles\/([a-z0-9-]+)\/?\)/g)].map((m) => m[1]);
  const allowedSlugs = new Set(articles.map((a) => a.slug));
  const unexpected = linkedSlugs.filter((slug) => !allowedSlugs.has(slug));
  if (unexpected.length > 0) {
    console.warn('  WARNING: article links internally to slug(s) not in the known published list — verify manually before publishing:');
    for (const slug of unexpected) console.warn(`    - /articles/${slug}/`);
  }
}

// Google truncates search-result titles around ~60 characters — not a
// hard rule (a longer, clearly better title beats an artificially
// chopped one), so this warns rather than blocks.
function warnOnTitleLength(title) {
  if (title.length > 65) {
    console.warn(`  NOTE: title is ${title.length} chars — may get truncated in search results (aim for ~60): "${title}"`);
  }
}

// Same non-fatal spirit as the citation check above: the system prompt
// tells the model to avoid these, but LLMs default back to them easily,
// so this flags any that slipped through rather than trusting the
// instruction silently.
const AI_CLICHE_PATTERNS = [
  /in today's fast-paced world/i,
  /it'?s important to note that/i,
  /it'?s worth noting/i,
  /in conclusion,/i,
  /delve into/i,
  /navigate the/i,
  /unlock the/i,
  /game[\s-]changer/i,
  /tapestry/i,
  /elevate your/i,
  /in the realm of/i,
  /dive into the world of/i,
  /a testament to/i,
  /stands as a/i,
];

function warnOnAiClicheLanguage(bodyMarkdown) {
  const hits = AI_CLICHE_PATTERNS.map((re) => bodyMarkdown.match(re)?.[0]).filter(Boolean);
  if (hits.length > 0) {
    console.warn(`  NOTE: found ${hits.length} stock AI-writing phrase(s), consider a pass to tighten: ${hits.join(', ')}`);
  }
}

// Category -> scene hints, so the hero photo is actually about the
// article's topic rather than one generic image for every piece. Each
// category has two variants:
// - withPerson: a template with a {subject} placeholder, filled in by
//   randomEthnicity() below. A soft "diverse" instruction on its own
//   wasn't reliably producing variety in practice — every hero image
//   ended up as a Black woman regardless — so ethnicity is now chosen
//   explicitly per image instead of left to the model's own judgment.
// - objectOnly: a person-free alternative (equipment, a meal, a journal
//   and tea, etc.) so hero images aren't always a photo of a woman.
const HERO_SCENE_HINTS = {
  Body: {
    withPerson:
      '{subject} mid-set in a strength workout, doing a bodyweight exercise, or in an everyday healthy-routine moment — lifting weights, a push-up or stretch, walking outside, focused and natural',
    objectOnly:
      'workout equipment in an inviting home or gym setting — dumbbells, a yoga mat, running shoes by a door, or a water bottle and towel after a workout, natural light, no people',
  },
  Food: {
    withPerson: '{subject} preparing or enjoying a wholesome meal in her kitchen, natural light',
    objectOnly:
      'a wholesome home-cooked meal or fresh ingredients laid out on a kitchen counter, natural light, no people',
  },
  Mind: {
    withPerson:
      '{subject} in a quiet, grounding moment — journaling, stretching, or sitting with a warm drink, calm and present',
    objectOnly:
      'a journal, a warm drink, and soft natural light on a quiet windowsill or desk — a calm, grounding still life, no people',
  },
  Hormones: {
    withPerson:
      '{subject} in a calm, everyday self-care moment — resting a hand on her stomach, sitting with tea, or a quiet moment checking in with herself, warm natural light',
    objectOnly: 'a warm cup of tea and a soft blanket in a calm, quiet corner of a home, warm natural light, no people',
  },
  Love: {
    withPerson:
      '{subject} with a warm, confident expression in a candid moment — journaling, laughing with a friend, or a quiet moment of self-reflection',
    objectOnly: 'two coffee cups on a table between friends, or a handwritten note and pen, warm natural light, no people',
  },
  Beauty: {
    withPerson:
      '{subject} doing a simple skincare or self-care routine — washing her face, applying moisturizer, or a quiet bathroom-mirror moment, natural light',
    objectOnly: 'simple skincare products arranged on a bathroom shelf or counter, soft natural light, no people',
  },
  Sleep: {
    withPerson: '{subject} resting or gently stretching in a cozy setting, soft morning or evening light',
    objectOnly: 'a made bed with soft linens in warm morning or evening light, a cozy bedroom scene, no people',
  },
  'Life Stages': {
    withPerson:
      "{subject} in an everyday moment that reflects where she's at in life — with a baby, mid-workout in her 40s, or simply going about her day, natural and unposed",
    objectOnly: 'everyday objects that reflect a life stage — a baby item, a well-used planner, or a pair of walking shoes by a door, natural light, no people',
  },
};

// Explicit ethnicity rotation — see the comment on HERO_SCENE_HINTS above
// for why this replaced a vague "diverse" instruction.
const ETHNICITIES = ['a Black woman', 'a white woman', 'an Asian woman', 'a Latina woman', 'a South Asian woman', 'a Middle Eastern woman'];

function randomEthnicity() {
  return ETHNICITIES[Math.floor(Math.random() * ETHNICITIES.length)];
}

async function generateHeroImage(title, slug, category) {
  try {
    console.log('Generating hero image...');
    const hints = HERO_SCENE_HINTS[category];
    // Roughly 1 in 3 hero images is a person-free object/scene shot
    // instead of a photo of a woman — see HERO_SCENE_HINTS' comment.
    const useObjectOnly = Math.random() < 1 / 3;
    const sceneHint =
      useObjectOnly || !hints
        ? (hints?.objectOnly ?? 'objects or a scene related to the topic, no people')
        : hints.withPerson.replace('{subject}', randomEthnicity());
    const imagePrompt = `Editorial lifestyle photograph for a women's health and wellness article titled "${title}". Show ${sceneHint}. Candid, documentary-style composition — natural and unposed, not an overly retouched stock-photo look. Natural, warm lighting; soft warm color grading (cream, muted plum, blush undertones) to match an editorial brand palette. Shallow depth of field for an artistic, magazine-quality feel. Absolutely no text, words, letters, numbers, captions, titles, logos, or watermarks anywhere in the image — this must be a clean photograph with zero typography of any kind.`;
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
are provided, write in general terms without any links or citations.

INTERNAL LINKS: You may also be given a list of Mindtivate's own existing
published articles. Where one is genuinely relevant to a specific point
you're making — not just topically adjacent — link to it inline using
its exact path from the list, with descriptive anchor text (never "click
here" or "this article"). Same rule as external sources: never invent a
path to an article that isn't on the list. Don't force it — 0-2 internal
links in a piece is normal; stuffing one in every section reads as SEO
padding, not a genuine reference. If no other articles are listed (or
none are actually relevant), don't include any internal links.

TITLE: Make it specific and genuinely interesting, not generic. Prefer a
concrete number, a named formula/method, a real tension, or the actual
question being asked over a flat label ("A Guide to X", "Understanding
X"). No clickbait or curiosity-gap withholding ("You Won't Believe...")
— that cuts against the evidence-based tone. Keep it under ~60
characters where the template's title format allows, since Google
truncates search results around there; a few extra characters for a
clearly better, more specific title beats an artificially chopped one.

SEO: Work the article's actual topic/primary phrase naturally into the
title and the first 1-2 sentences of the body — a reader or search
engine should know what this is about immediately, not after a
throat-clearing intro. The "description" field is the search-result
snippet, not just a summary: write it to earn the click (specific,
concrete, under 160 characters), not as a dry restatement of the title.
Subheadings should be specific and descriptive ("Why cortisol spikes
after a bad night's sleep", not "Background" or "More Information").
Never keyword-stuff — repeating the same phrase unnaturally reads badly
to humans and is penalized by modern search ranking; write for the
reader first.

SOUND LIKE A PERSON WROTE THIS, NOT AN AI: avoid stock AI-writing tells —
phrases like "in today's fast-paced world," "it's important to note
that," "it's worth noting," "in conclusion," "delve into," "navigate
the," "unlock the," "game-changer," "tapestry," "elevate your," "in the
realm of," "dive into the world of," "a testament to," "stands as a."
Vary sentence length — a short sentence next to a longer one reads more
human than uniform medium-length sentences throughout. Use contractions
where a person would ("it's," "you're," "don't"). Prefer concrete,
specific detail over vague generalities. Don't hedge every claim into
mush ("may potentially help support") — state what the evidence actually
shows, with appropriate uncertainty only where the evidence itself is
genuinely mixed. Vary paragraph length too, not just sentences — a
one- or two-sentence paragraph next to a longer one reads more natural
than uniform blocks of text. Occasionally break up a longer sentence
with a parenthetical aside or an em dash instead of always reaching for
a comma or starting a new sentence. Don't lean on the same word for the
same idea every time it comes up — vary it the way a person naturally
would (if you've called something "a habit" once, the next reference
can be "the routine," "that pattern," and so on). A well-placed,
genuinely clarifying analogy or comparison lands more human than a
purely clinical explanation — but only reach for one where it actually
illuminates the point, never as decoration. It's fine for the register
to shift slightly within a piece — mostly clear and direct, with an
occasional more-conversational aside — rather than holding one uniform
tone for the entire length.`;

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

  const existingArticles = listPublishedArticles();
  console.log(`Found ${existingArticles.length} existing published article(s) as internal-link candidates.`);
  const internalLinksBlock = existingArticles.length
    ? `\n\nMindtivate's own published articles you may link to internally (use these exact paths as markdown links, only where genuinely relevant; do not invent a path to an article not listed):\n${existingArticles
        .map((a) => `- "${a.title}" (/articles/${a.slug}/) — ${a.description}`)
        .join('\n')}`
    : '\n\nNo other published articles exist yet — do not include any internal /articles/ links.';

  const prompt = `Pain point (from r/${entry.painPoint.subreddit}): "${entry.painPoint.title}"
Detail: ${entry.painPoint.selftextExcerpt}

Product research brief: ${entry.brief.category} — ${entry.brief.searchQuery}
Problem it should solve: ${entry.brief.problemSolved}
${product ? `\nMatched product record: "${product.name}" — ${product.shortPitch}` : '\nNo specific product matched yet — write the article without a hard product recommendation.'}
${sourcesBlock}
${internalLinksBlock}

Write the article JSON now.`;

  console.log(`Drafting article with Poe (template: ${template.label})...`);
  const draft = await askPoeForJson({ system: buildSystemPrompt(template), prompt, maxTokens: template.maxTokens });
  warnOnUnexpectedCitations(draft.bodyMarkdown, sources);
  warnOnUnexpectedInternalLinks(draft.bodyMarkdown, existingArticles);
  warnOnTitleLength(draft.title);
  warnOnAiClicheLanguage(draft.bodyMarkdown);

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

// Guarded rather than an unconditional top-level call so this file can
// also be safely `import`ed for generateHeroImage (stage 4 reuses it to
// regenerate a hero image that failed the text QA check) without
// triggering a full drafting run — process.argv[1] only equals this
// file's own path when it's the actual entrypoint (`node
// 3-generate-article.mjs`), not when something else imports from it.
if (import.meta.url === `file://${process.argv[1]}`) {
  run().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}

export { generateHeroImage };

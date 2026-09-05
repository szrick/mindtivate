#!/usr/bin/env node
// Stage 3: draft an article from a researched pain point (+ optional
// matched product) using Poe. Always writes with status: draft,
// draft: true — nothing this script produces is publishable until a human
// reviews it (in Pages CMS or a PR) and flips status to published.
//
// Also via Poe: a best-effort search for real authority sources to cite
// (POE_SEARCH_MODEL) and a generated hero illustration + product image
// (POE_IMAGE_MODEL). The hero image itself is a random mix of AI
// generation and real, licensed stock photos (Pexels/Unsplash, see
// scripts/lib/stockphotos.mjs — PEXELS_API_KEY/UNSPLASH_ACCESS_KEY,
// optional). All of this is non-fatal — if any of it fails, drafting
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
import { findStockPhoto } from '../lib/stockphotos.mjs';
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

// Rough, keyword-style search query per category — used as a stock-photo
// fallback query when the draft didn't suggest any topic-specific
// heroImageIdeas (or none were usable). Deliberately short/concrete
// rather than a full sentence, since Pexels/Unsplash search works like a
// keyword search, not a prompt.
const CATEGORY_STOCK_QUERY_FALLBACK = {
  Body: 'woman fitness workout',
  Food: 'healthy meal kitchen',
  Mind: 'woman journaling calm',
  Hormones: 'self care tea',
  Love: 'friends coffee conversation',
  Beauty: 'skincare routine bathroom',
  Sleep: 'cozy bed morning light',
  'Life Stages': 'woman everyday lifestyle',
};

// Category -> scene-building pools, so hero photos actually vary within
// a category instead of every article getting the same one or two fixed
// sentences. Each category defines:
// - activities: a LIST of solo-subject poses/actions (was a single fixed
//   string before — the main reason same-category articles looked
//   near-identical). One is picked at random and combined with a
//   randomly-rolled subject descriptor (ethnicity/age/body type) and
//   clothing style below.
// - settings: a LIST of places that activity/group scene can happen in.
// - clothing: a LIST of category-appropriate outfits (kept per-category
//   rather than global, so a Sleep image never rolls "sports bra and
//   leggings").
// - objectOnly: a LIST of person-free alternatives (equipment, a meal, a
//   journal and tea, etc.), each already a complete, self-contained
//   scene (no clothing/setting wrapping needed).
// - group (optional): a LIST of small-group/two-person scene phrases,
//   only defined where a group genuinely fits the category. Also
//   already self-contained.
// All of these plus per-article heroImageIdeas (from the drafting JSON
// response) feed into one big randomized candidate pool in
// buildSceneCandidates below, and lighting/mood/composition/color
// palette/style are then rolled completely independently on top — see
// generateHeroImage.
const HERO_SCENE_HINTS = {
  Body: {
    activities: [
      'mid-set doing a dumbbell squat',
      'in a deadlift stance with a barbell',
      'holding a push-up plank position',
      'mid-swing with a kettlebell',
      'jumping rope',
      'running along an outdoor trail',
      'stretching after a workout',
      'doing a bodyweight lunge',
    ],
    settings: [
      'a small home gym corner',
      'a sunny outdoor park path',
      'a minimal studio with a plain backdrop',
      'a living room cleared for a workout',
      'a neighborhood running trail',
    ],
    clothing: ['a sports bra and leggings', 'a loose tank top and running shorts', 'a fitted workout set', 'casual athleisure'],
    objectOnly: [
      'a pair of dumbbells and a yoga mat on a wood floor, natural light, no people',
      'running shoes by a front door with a water bottle nearby, no people',
      'a kettlebell and resistance bands laid out in a home gym corner, no people',
      'a towel and water bottle on a gym bench after a workout, no people',
    ],
    group: [
      'two women of different ages spotting each other during a strength workout',
      'a small, diverse group of three women stretching together after a run',
    ],
  },
  Food: {
    activities: [
      'chopping colorful vegetables at the counter',
      'plating a wholesome bowl of food',
      'pouring a smoothie into a glass',
      'portioning meal-prep containers',
      'stirring a pot on the stove',
      'washing fresh produce at the sink',
    ],
    settings: ['a bright home kitchen', 'a kitchen island covered in fresh ingredients', 'a sunny breakfast nook', 'an outdoor picnic table'],
    clothing: ['a simple apron over casual clothes', 'a relaxed home outfit', 'a linen shirt rolled at the sleeves'],
    objectOnly: [
      'a wholesome home-cooked meal on a wood table, natural light, no people',
      'fresh vegetables and herbs laid out on a kitchen counter, no people',
      'meal-prep containers with colorful, balanced meals, no people',
      'a smoothie and fresh fruit on a sunny counter, no people',
    ],
    group: ['two women cooking together in a home kitchen, laughing over a shared task'],
  },
  Mind: {
    activities: [
      'writing in a journal',
      'sitting cross-legged in a quiet meditation moment',
      'stretching gently on a mat',
      'reading a book curled up in a chair',
      'sipping a warm drink while looking out a window',
      'taking a slow walk outdoors',
    ],
    settings: ['a quiet reading nook', 'a sunlit windowsill corner', 'a calm bedroom corner', 'a park bench under trees', 'a cozy living room chair'],
    clothing: ['a soft cardigan over loungewear', 'a cozy sweater and leggings', 'comfortable everyday clothes'],
    objectOnly: [
      'a journal, a warm drink, and soft natural light on a quiet windowsill, no people',
      'a candle, a folded blanket, and a book on a side table, no people',
      'a cup of tea and an open journal on a wooden desk, no people',
    ],
  },
  Hormones: {
    activities: [
      'resting a hand gently on her stomach in a quiet moment',
      'sitting with a warm cup of tea, reflective',
      'doing a gentle self-care stretch',
      'looking thoughtfully out a window',
    ],
    settings: ['a calm bedroom corner', 'a quiet living room chair', 'a sunlit bathroom counter', 'a cozy reading nook'],
    clothing: ['a soft robe', 'comfortable loungewear', 'a cozy oversized sweater'],
    objectOnly: [
      'a warm cup of tea and a soft blanket in a quiet corner of a home, no people',
      'a heating pad and a cup of herbal tea on a nightstand, no people',
      'a journal and a cup of tea on a sunlit windowsill, no people',
    ],
  },
  Love: {
    activities: [
      'laughing with a friend over coffee',
      'writing a heartfelt note',
      'sitting in quiet self-reflection',
      'walking and talking with a friend outdoors',
      'sharing a warm conversation at a kitchen table',
    ],
    settings: ['a cozy café corner', 'a park bench', 'a kitchen table', 'a living room couch', 'a sunny porch'],
    clothing: ['a relaxed everyday outfit', 'a casual sweater and jeans'],
    objectOnly: [
      'two coffee cups on a table between friends, warm natural light, no people',
      'a handwritten note and pen on a wooden desk, no people',
      'two mugs and a small plate of pastries on a café table, no people',
    ],
    group: [
      'two women laughing together over coffee at a café table',
      'a small group of three friends walking and talking outdoors',
    ],
  },
  Beauty: {
    activities: [
      'washing her face at the bathroom sink',
      'applying moisturizer in front of a mirror',
      'brushing her hair',
      'doing a simple skincare routine at a vanity',
      'towel-drying her hair after a shower',
    ],
    settings: ['a bright bathroom counter', 'a bedroom vanity', 'a sunlit bathroom mirror', 'a simple minimal bathroom'],
    clothing: ['a soft robe', 'a towel wrapped around her hair', 'comfortable loungewear'],
    objectOnly: [
      'simple skincare products arranged on a bathroom shelf, soft natural light, no people',
      'a hairbrush and hair ties on a vanity table, no people',
      'a towel and skincare bottles by a bathroom sink, no people',
    ],
  },
  Sleep: {
    activities: [
      'stretching gently before bed',
      'reading in bed by lamp light',
      'waking up and stretching in bed',
      'resting peacefully under soft linens',
    ],
    settings: ['a cozy bedroom', 'a bed with soft morning light', 'a reading nook by a bedside lamp'],
    clothing: ['soft pajamas', 'a cozy robe', 'comfortable loungewear'],
    objectOnly: [
      'a made bed with soft linens in warm morning light, a cozy bedroom scene, no people',
      'a bedside lamp, a book, and a cup of tea on a nightstand, no people',
      'a cozy blanket folded at the foot of a bed, no people',
    ],
  },
  'Life Stages': {
    activities: [
      'holding and gently rocking a baby',
      'mid-workout, focused and strong',
      'pushing a stroller on a walk',
      'sitting with a planner, organizing her week',
      'going about an everyday moment at home',
    ],
    settings: ['a nursery corner', 'a living room', 'an outdoor neighborhood path', 'a home office desk', 'a kitchen table'],
    clothing: ['comfortable everyday clothes', 'casual athleisure', 'a relaxed home outfit'],
    objectOnly: [
      'a baby item like a soft blanket or small shoes by a crib, no people',
      'a well-used planner and pen on a desk, no people',
      'a pair of walking shoes by a front door, no people',
    ],
    group: ['a woman and her toddler playing together on the floor'],
  },
};

// Subject attribute pools — ethnicity, apparent age, and body type are
// rolled independently of each other and of the category, so "solo"
// scenes get a fresh, specific subject every time instead of just a
// rotating ethnicity on an otherwise-identical sentence. A soft "diverse"
// instruction on its own wasn't reliably producing variety in practice
// (every hero image ended up as a Black woman regardless), so each axis
// is chosen explicitly rather than left to the model's own judgment.
const ETHNICITIES = ['a Black woman', 'a white woman', 'an Asian woman', 'a Latina woman', 'a South Asian woman', 'a Middle Eastern woman'];
const AGE_RANGES = ['in her early 20s', 'in her 30s', 'in her 40s', 'in her 50s'];
const BODY_TYPES = ['an athletic build', 'a curvy build', 'a petite frame', 'a tall, lean build', 'an average build'];

// Composition/camera, lighting+mood, color palette, and style are all
// rolled independently per image and apply regardless of which scene
// candidate was picked — previously these were hardcoded identically
// into every single prompt ("Candid, documentary-style... cream, muted
// plum, blush undertones..."), which was as much a cause of same-y
// images as the fixed one-sentence-per-category scenes were.
const COMPOSITIONS = [
  'full-body shot, eye-level angle',
  'three-quarter shot, slightly low angle for an empowering feel',
  'waist-up framing, eye-level',
  'close-up on hands and detail, overhead angle',
  'side-profile shot with negative space to one side for text overlay',
];
const LIGHTING_MOODS = [
  { lighting: 'soft morning window light', mood: 'calm and serene' },
  { lighting: 'golden hour outdoor light', mood: 'warm and energetic' },
  { lighting: 'overcast, diffuse daylight', mood: 'clean and fresh' },
  { lighting: 'warm indoor lamp light', mood: 'cozy and comforting' },
  { lighting: 'bright, soft natural daylight', mood: 'focused and determined' },
];
const COLOR_PALETTES = [
  'muted sage green, warm beige, and soft white',
  'cream, muted plum, and blush undertones',
  'warm terracotta, sand, and ivory',
  'soft slate blue, warm gray, and cream',
  'dusty rose, warm taupe, and off-white',
];
const STYLE_DESCRIPTORS = [
  'photorealistic editorial photography, shallow depth of field, natural skin texture, no heavy retouching',
  'natural documentary-style photography, candid and unposed, shot on a 35mm-equivalent lens',
  'soft modern lifestyle photography, gentle natural light, minimal styling',
  'clean, minimal wellness-brand photography, softly blurred background, uncluttered composition',
];
// Kept as one explicit, comprehensive line rather than scattered through
// the prompt — the "zero typography" phrasing here is deliberately
// strong (a single soft "no logos/watermarks" mention wasn't reliably
// keeping text out of generated images in practice).
const NEGATIVE_CONSTRAINTS =
  'Avoid: overly sexualized poses or clothing, exaggerated stock-photo expressions or fake-looking group laughter, extreme bodybuilder physiques, distorted anatomy or extra limbs, watermarks, logos, or UI elements, and absolutely no text, words, letters, numbers, captions, titles, or typography anywhere in the image — this must be a clean photograph with zero typography of any kind.';

function randomSubjectDescriptor() {
  return `${pickRandom(ETHNICITIES)} ${pickRandom(AGE_RANGES)}, with ${pickRandom(BODY_TYPES)}`;
}

// Random pick, one array-index roll — used for every pool above.
function pickRandom(list) {
  return list[Math.floor(Math.random() * list.length)];
}

// Builds the pool of possible "core scene" phrases for one hero image:
// one resolved solo-subject scene (subject + clothing + activity +
// setting, each rolled independently), one resolved small-group scene
// (only if the category defines one), every one of the category's
// person-free objectOnly scenes, and every one of this article's own
// topic-specific heroImageIdeas. generateHeroImage picks one at random
// from the combined pool — see the comment on HERO_SCENE_HINTS above for
// why a flat "one sentence per category" no longer cuts it.
function buildSceneCandidates(category, ideas) {
  const hints = HERO_SCENE_HINTS[category];
  const candidates = [];

  if (hints) {
    const subject = randomSubjectDescriptor();
    const clothing = pickRandom(hints.clothing);
    const activity = pickRandom(hints.activities);
    const setting = pickRandom(hints.settings);
    candidates.push(`${subject}, wearing ${clothing}, ${activity} in ${setting}`);

    if (hints.group) candidates.push(`${pickRandom(hints.group)} in ${pickRandom(hints.settings)}`);

    candidates.push(...hints.objectOnly);
  }

  candidates.push(...ideas);

  return candidates.length ? candidates : ['objects or a scene related to the topic, no people'];
}

// Tries a real, licensed stock photo (Pexels/Unsplash) for roughly half
// of hero images when at least one is configured — real photography
// avoids the "AI-generated, not real photography" caveat entirely for
// whichever images use it (see COMPLIANCE.md), on top of adding variety
// AI generation alone can't. Prefers a topic-specific idea from `ideas`
// as the search query when one exists (a search engine works far better
// on "a toddler playing with wooden blocks" than on a full AI-prompt
// sentence); falls back to a short category keyword query otherwise.
// Returns the same shape generateHeroImage does, or null if stock photos
// aren't configured, weren't rolled this time, or nothing was found.
async function tryStockPhoto(category, ideas) {
  const stockConfigured = Boolean(process.env.PEXELS_API_KEY || process.env.UNSPLASH_ACCESS_KEY);
  if (!stockConfigured || Math.random() >= 0.5) return null;

  const query = ideas.length ? pickRandom(ideas) : CATEGORY_STOCK_QUERY_FALLBACK[category] || 'wellness lifestyle';
  console.log(`  trying a real stock photo for "${query}"...`);
  const stockPhoto = await findStockPhoto(query);
  if (!stockPhoto) {
    console.log('  no stock photo match found -- falling back to AI generation');
    return null;
  }

  console.log(`  found a ${stockPhoto.sourceName} photo by ${stockPhoto.photographer}`);
  return {
    ext: stockPhoto.ext,
    buffer: stockPhoto.buffer,
    heroImageAlt: `Photo related to "${query}"`,
    heroImageSource: stockPhoto.sourceName,
    heroImagePhotographer: stockPhoto.photographer,
    heroImagePhotographerUrl: stockPhoto.photographerUrl,
    heroImageSourceUrl: stockPhoto.sourceUrl,
  };
}

// `ideas` is an optional array of short, topic-specific visual concepts
// (from the draft JSON's heroImageIdeas — see buildSystemPrompt) tied to
// this specific article rather than just its category, e.g. "a toddler
// playing with wooden blocks" for a preschool-behavior piece or "a
// pharmacy shelf with medicine bottles" for a medication one. Defaults
// to [] so this stays safe to call without them (stage 4 reuses this
// function to regenerate a hero image that failed QA, working from just
// title/category at that point).
async function generateHeroImage(title, slug, category, ideas = []) {
  try {
    console.log('Generating hero image...');

    const stockResult = await tryStockPhoto(category, ideas);
    let result = stockResult;

    if (!result) {
      // Every axis below is rolled independently: which scene, the
      // camera/composition, the lighting+mood, the color palette, and
      // the photographic style. Previously composition/lighting/palette/
      // style were hardcoded identically into every prompt regardless of
      // scene — as much a cause of same-y images as the old one-sentence-
      // per-category scene pool was. See buildSceneCandidates above.
      const sceneHint = pickRandom(buildSceneCandidates(category, ideas));
      const composition = pickRandom(COMPOSITIONS);
      const { lighting, mood } = pickRandom(LIGHTING_MOODS);
      const palette = pickRandom(COLOR_PALETTES);
      const style = pickRandom(STYLE_DESCRIPTORS);

      const imagePrompt = `Editorial lifestyle photograph for a women's health and wellness article titled "${title}". Show ${sceneHint}. The scene uses ${lighting} to create a ${mood} mood. Composition: ${composition}. Color palette: ${palette}. Style: ${style}. ${NEGATIVE_CONSTRAINTS}`;
      const { buffer, ext } = await generatePoeImage({ prompt: imagePrompt });
      result = { buffer, ext, heroImageAlt: `Lifestyle photo related to "${title}"` };
    }

    const imagesDir = 'src/content/articles/_images';
    mkdirSync(imagesDir, { recursive: true });
    const imageFileName = `${slug}-hero.${result.ext}`;
    writeFileSync(`${imagesDir}/${imageFileName}`, result.buffer);
    console.log(`  saved ${imagesDir}/${imageFileName}`);
    return {
      heroImage: `./_images/${imageFileName}`,
      heroImageAlt: result.heroImageAlt,
      ...(result.heroImageSource
        ? {
            heroImageSource: result.heroImageSource,
            heroImagePhotographer: result.heroImagePhotographer,
            heroImagePhotographerUrl: result.heroImagePhotographerUrl,
            heroImageSourceUrl: result.heroImageSourceUrl,
          }
        : {}),
    };
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
  "heroImageIdeas": string[] (2-4 short, concrete visual ideas SPECIFIC to
    this article's actual topic, not just its category -- a real object,
    setting, or related subject someone would associate with it, not a
    generic "woman doing wellness" scene. May or may not include a
    person: e.g. for an article about a toddler's preschool behavior,
    good ideas are "a toddler playing with wooden blocks" or "a
    preschool classroom cubby"; for one about a specific medication,
    "a pharmacy shelf with medicine bottles" or "a hand holding a
    prescription bottle". Each idea should work standing alone as either
    an image-generation prompt fragment or a stock-photo search query --
    a few words to one short phrase, not a full sentence.),
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

  // --product explicitly overrides; otherwise, if stage 2 already
  // resolved this brief into a real product automatically (via CJ — see
  // 2-product-match.mjs), bind that product to this article directly
  // rather than leaving it to stage 4's generic cross-catalog matching,
  // which judges relevance from the finished article text and might not
  // pick it even though it was sourced from this exact pain point.
  const productSlug = args.product || entry.cjProduct?.slug;
  const product = productSlug ? loadProduct(productSlug) : null;
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

  const heroImageIdeas = Array.isArray(draft.heroImageIdeas) ? draft.heroImageIdeas.filter(Boolean) : [];
  const heroImageFields = await generateHeroImage(draft.title, slug, draft.category, heroImageIdeas);

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

export { generateHeroImage, BASE_VOICE_PROMPT, warnOnAiClicheLanguage };

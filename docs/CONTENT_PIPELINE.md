# Content pipeline

End-to-end path from a Reddit thread to a published, promoted article.

## 1. Research (`scripts/pipeline/1-reddit-research.mjs`)

Scans 5 subreddits per site category by default (40 total —
`DEFAULT_SUBREDDITS_BY_CATEGORY` in the script), so each of the 8
categories (`src/lib/categories.ts`: Body, Food, Mind, Hormones, Love,
Beauty, Sleep, Life Stages) draws from a real spread of communities
instead of one source each:

| Category | Subreddits |
|---|---|
| Body | xxfitness, loseit, bodyweightfitness, Fitness, GYM |
| Food | nutrition, EatCheapAndHealthy, MealPrepSunday, intermittentfasting, volumeeating |
| Mind | mentalhealth, GetMotivated, Anxiety, selfimprovement, DecidingToBeBetter |
| Hormones | WomensHealth, PCOS, Menopause, period, TwoXChromosomes |
| Love | relationship_advice, dating_advice, relationships, Marriage, datingoverthirty |
| Beauty | SkincareAddiction, MakeupAddiction, HaircareScience, 30PlusSkinCare, beauty |
| Sleep | sleep, insomnia, flexibility, stretching, backpain |
| Life Stages | AskWomen, Mommit, beyondthebump, AskWomenOver30, Parenting |

The first 2-3 per row are well-established, high-traffic communities;
the rest are real but smaller/more niche — if one consistently returns 0
candidates, it may just be quieter than expected, or worth swapping via
`--subreddits`. Each result is tagged with a `targetCategory` field
(a hint from which category's search found it, not an authoritative
classification — stage 3 still assigns the article's actual category).
This is a lot more subreddits than before, so a default run takes
noticeably longer and makes many more Arctic Shift requests than the
old single-subreddit-per-category version.

For recent posts, filters for ones that read like a specific, recurring,
answerable problem (regex
heuristics for phrases like "any recommendations", "how do I",
"struggling with"; excludes megathreads and mod posts), and keeps ones
with at least 5 comments as a signal the question resonates. Writes
candidates to `scripts/pipeline/output/research-<timestamp>.json`
(gitignored — this is working data, not published content).

To scope a run to a specific topic or subreddit set (e.g. a weight-loss
batch) instead of editing the script:

```bash
npm run pipeline:research -- --subreddits loseit,xxfitness,nutrition
npm run pipeline:research -- --subreddits loseit --query "weight loss"
```

`--subreddits` overrides the whole default (a flat custom list, not
grouped/tagged by category — for a one-off topic-scoped batch); `--query`
switches from a plain chronological scan to Arctic Shift's keyword
search (title +
selftext) within each scoped subreddit, so results actually match the
topic instead of just whatever's most recent.

Reads from [Arctic Shift](https://arctic-shift.photon-reddit.com/)
(`scripts/lib/arcticshift.mjs`), a free third-party Reddit archive, rather
than Reddit's own API — no Reddit app, approval, or account needed for
this stage. See `docs/SETUP.md` for why (Reddit now gates new OAuth
tokens behind manual approval). A real Reddit app is still required for
stage 6's optional comment-posting, since that inherently needs an
authenticated Reddit session — see that section below.

## 2. Product match (`scripts/pipeline/2-product-match.mjs`)

For each pain point, asks a model (via the [Poe API](https://poe.com/api_key),
`scripts/lib/poe.mjs` — set `POE_API_KEY` and optionally `POE_MODEL`) to
produce a **research brief** — a
product category and a search query — not a specific product or link.
Finding a real product and getting into its affiliate program is
inherently a human step (browsing, comparing, applying, waiting for
approval), so this stage stops short of it on purpose. Output:
`scripts/pipeline/output/product-briefs-<timestamp>.json`.

**Manual step:** research the brief, apply to the affiliate program
(Amazon Associates, ShareASale, a direct brand program, etc.), then create
or update a file in `src/content/products/` — either directly or through
Pages CMS's "Products" collection — with `affiliateStatus` and
`affiliateUrl` once approved. Until then, leave `affiliateStatus:
not-applied` (or `applied`); `ProductCallout.astro` will not render a live
link for anything less than `approved`/`active`.

## 3. Draft (`scripts/pipeline/3-generate-article.mjs`)

Takes one pain point + brief (and, if you pass `--product <slug>`, a real
product record) and, via the [Poe API](https://poe.com/api_key)
(`scripts/lib/poe.mjs`), does three things:

1. **Searches for authority sources** (`POE_SEARCH_MODEL`, a web-search-
   capable Poe bot) — a best-effort lookup for real, currently-reachable
   .gov/.edu/major-health-org URLs relevant to the topic. If this fails or
   returns nothing, drafting continues without citations rather than
   blocking. When sources are found, the article prompt requires the model
   to cite at least one as an inline markdown link, using only the exact
   URLs returned — it's instructed never to invent a URL of its own.
2. **Drafts the article** (`POE_MODEL`) in Mindtivate's editorial voice
   (see `BASE_VOICE_PROMPT` in the script — never diet-culture/fear-based,
   no medical diagnoses, cite only verified sources, one natural product
   mention — this stays fixed no matter which structure template is
   used). `BASE_VOICE_PROMPT` also carries three quality rules that apply
   to every template:
   - **Titles**: specific and genuinely interesting over generic ("A
     Guide to X"), no clickbait/curiosity-gap withholding, aimed at
     under ~60 characters (Google's search-result truncation point)
     where the template's title format allows.
   - **SEO**: work the actual topic into the title and the first 1-2
     sentences (no throat-clearing intro), write the meta description to
     earn the click rather than just restate the title, descriptive
     subheadings — explicitly instructed *against* keyword-stuffing,
     since that reads badly to humans and is penalized by modern search
     ranking anyway.
   - **Sounds human, not AI-generated**: an explicit list of stock
     AI-writing tells to avoid ("delve into," "in today's fast-paced
     world," "game-changer," etc.), vary sentence length, use
     contractions, prefer concrete detail over hedged generalities.

   Two non-fatal post-generation checks back these up (same "trust but
   verify" pattern as the citation check below) — `warnOnTitleLength`
   flags a title over 65 characters, and `warnOnAiClicheLanguage` flags
   any of those stock phrases that slipped through anyway. Neither
   blocks the write; both just print a note so a human reviewer knows to
   look.

   Always writes with `status: draft` and `draft: true` — the
   schema in `src/content/config.ts` defaults to draft too, so a script
   that forgot to set it would still not publish.

   **Structure templates** (`scripts/lib/article-templates.mjs`, chosen
   via `--template <id>`, defaults to `standard`) control shape/length/
   style on top of that fixed voice:
   - `standard` (600-900 words) — open-ended explainer, `##` subheadings
     as content calls for them. The original/default shape.
   - `self-listicle` (1100-1300 words) — modeled on self.com's "[N]
     Simple [Time] Habits That [Benefit]" format: intro (hook + nuance +
     reassurance + list setup) then one `##` per habit (why → what → how,
     ~200-300 words each), no separate conclusion — the last habit
     doubles as the wrap-up. Second-person, short paragraphs,
     conversational connective phrases.
   - `quick-hacks` (800-1200 words) — fast/snackable, Marie Claire
     "hacks" style: very tight intro, 4-6 punchy tips (~120-180 words
     each), minimal science depth, speed-focused framing.
   - `personal-essay` (700-1000 words) — opens grounded in the real
     Reddit poster's actual situation (quoted/paraphrased, explicitly
     attributed to them), pivots into the site's usual third-person
     analysis, closes back on their situation. Deliberately *not* a
     first-person "I tried X" narrative written as the site's own
     experience — that would violate COMPLIANCE.md's rule against
     presenting AI-drafted content as a real personal anecdote under the
     anonymous `mindtivate-team` byline. This template exists to capture
     the engagement value of concrete, specific, emotionally-grounded
     openings without that honesty problem.
   - `myth-vs-fact` (900-1200 words) — 3-5 `## Myth: ...` / **Fact:**
     pairs, each correction specific (numbers/timeframes/mechanisms, not
     "it depends"), myths grounded in real misconceptions from the
     source thread rather than invented strawmen.
   - `ask-the-expert-qa` (900-1200 words) — 4-6 literal question-then-
     answer pairs, phrased the way a real reader would actually ask,
     escalating from basic to nuanced.
   - `self-assessment-checklist` (700-1000 words) — a reflective
     checklist (5-8 items) the reader works through, explicitly framed as
     non-diagnostic, with a "what your answers might mean" section in
     rough bands rather than a verdict.
   - `step-by-step-guide` (800-1100 words) — front-loaded value
     statement, then 4-7 numbered `## Step N:` sections, closing with a
     realistic expectation-setting note instead of a generic sign-off.
   - `comparison` (900-1200 words) — "X vs. Y" format: neutral
     definitions of each option, then key differences, then situational
     ("if X, go with A; if Y, go with B") guidance rather than crowning
     one universal winner.

   The 6 non-`standard`/`self-listicle`/`quick-hacks` templates above
   were derived from research into what actually drives engagement/
   retention in health content (personal essays, myth-correction
   Q&A, expert-Q&A, interactive/checklist formats, how-to structure,
   and comparison content) — see the git history on
   `scripts/lib/article-templates.mjs` for the specific findings behind
   each one.

   Run with an unknown `--template` value to print the current list of
   valid ids. Add a new one by adding an entry to `ARTICLE_TEMPLATES` in
   `article-templates.mjs` — each needs `wordCountTarget`, `maxTokens`,
   and a `guidance` string describing the structure/style; the voice and
   compliance rules apply automatically regardless.
3. **Generates a hero photo** (`POE_IMAGE_MODEL`) for the article
   (`src/content/articles/_images/<slug>-hero.<ext>`) — an editorial-style
   lifestyle photograph of a woman in a candid, topically-relevant moment
   (the scene hint is chosen from the article's category — see
   `HERO_SCENE_HINTS` in the script), not a stock-photo pose or a single
   narrow beauty standard. Non-fatal — a failure just means no hero image.
   These are AI-generated, not real photography of a real person — see
   COMPLIANCE.md.
4. **Finds a product image on amazon.com** (`POE_SEARCH_MODEL`) — only if
   `--product` is passed and that product record doesn't already have an
   `image` field. This searches amazon.com for a matching real listing and
   downloads its photo (not AI-generated), saved under
   `src/content/products/_images/` and linked into the product's
   frontmatter automatically, with a comment flagging the match as
   **unverified** and noting the matched listing title/URL when found. Also
   non-fatal — no confirmed match just means no image, same as today.
   See COMPLIANCE.md for why this needs a human check (wrong-match risk,
   and rehosting a marketplace image outside Amazon's own API).

## Review

Open the new file in Pages CMS (or a PR, if `content-pipeline.yml`
generated it) and check:

- Does it actually answer the researched question?
- Is any product mention accurate, and does the linked product record have
  an approved, correct affiliate URL?
- **If a product image was pulled from amazon.com**, confirm it's actually
  the exact product (the match is unverified) before the affiliate link
  goes live, and consider replacing it with an image sourced through
  Amazon's Product Advertising API once you're an approved Associate.
- Do any cited sources actually say what the article claims? The search
  step finds real URLs, but doesn't verify the article represents them
  accurately — that's still a human check.
- Does the tone match — no diet-culture language, no medical claims?

Set `status: published` (and `draft: false`) and merge/save.

## 4. Publish

Nothing to run — merging to `main` triggers `deploy.yml`, which builds and
publishes to GitHub Pages. The article also immediately appears in
`/rss.xml`.

## Newsletter (automatic)

Configure a Sender.net **RSS-to-email automation** pointed at
`https://mindtivate.com/rss.xml`: Sender polls the feed and sends
subscribers a "new post" email automatically on the next poll after an
article is published. No code runs on the Mindtivate side for this — it's
the intended zero-maintenance path. `scripts/lib/sender.mjs` also exposes
`addSubscriberToGroup` for the one-off case of adding someone to a
segment/tag via API, but campaign sends should go through Sender's own
automation, not a custom script.

## 5. Pinterest (`scripts/pipeline/5-pinterest-pin.mjs`)

Run manually, after the article is live (Pinterest needs a public image
URL, so this has to happen post-deploy):

```bash
npm run pipeline:pin -- --slug your-article-slug --image https://mindtivate.com/images/your-hero.jpg
```

Creates a pin on the configured board linking to
`https://mindtivate.com/articles/<slug>/`. Prints the resulting pin URL —
add it back to the article's `pinterestPinUrl` field via Pages CMS.

## 6. Reddit engagement (`scripts/pipeline/6-reddit-engagement-draft.mjs`)

Two-step, human-gated by design:

```bash
# 1. Generate a draft comment (writes a JSON file, posts nothing)
npm run pipeline:engage -- --slug your-article-slug

# 2. Review scripts/pipeline/output/reddit-comment-drafts/your-article-slug.json,
#    edit the text if needed, re-check the subreddit's current rules, and
#    change "approved": false to "approved": true. Then:
npm run pipeline:engage -- --slug your-article-slug --post
```

See [COMPLIANCE.md](COMPLIANCE.md) for why this isn't a single automated
step.

## Scheduled automation

`.github/workflows/content-pipeline.yml` runs stages 1–3 every Monday and
opens a PR with any new drafts. It requires `POE_API_KEY` (stages 2 and 3
both run on Poe now) and the `REDDIT_*` secrets to be set as repository
secrets. `ANTHROPIC_API_KEY` is no longer needed by this workflow — stage 6
(Reddit engagement drafts) is the only remaining Anthropic caller, and that
stage is never run by this scheduled workflow. It never touches stages 5
or 6 and never merges its own PR.

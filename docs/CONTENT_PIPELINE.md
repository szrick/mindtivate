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
with at least 5 comments as a signal the question resonates. Also drops
any candidate whose thread URL matches an existing article's
`sourceThreadUrl` — drafted or published, status doesn't matter — so a
thread already turned into an article doesn't get drafted again just
because a later run rescans the same subreddits and it's still
recurring/popular. Also reorders the remaining candidates — see
`balanceCandidates()` in the script — so that drafting (which always
takes the first few, by index) spreads across categories and subreddits
instead of always landing on whichever is scanned first (previously
almost always Body/r/xxfitness, since it's first in
`DEFAULT_SUBREDDITS_BY_CATEGORY` and reliably has the most qualifying
posts). The reorder derives its rotation priority from the existing
article corpus itself (least-represented category/subreddit surfaces
first) rather than a separate state file, so it self-corrects as the
site's category balance changes over time. Writes candidates to
`scripts/pipeline/output/research-<timestamp>.json` (gitignored — this
is working data, not published content).

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

   **Internal links**: before drafting, `listPublishedArticles()` scans
   `src/content/articles/` for existing `status: published, draft:
   false` articles and offers them as internal-link candidates (title +
   `/articles/<slug>/` path + description) — same "here's the exact
   list, never invent one" pattern as external citations. The model is
   told to link only where genuinely relevant (not force one into every
   article) and to cap it around 0-2 links so it reads as a real
   reference, not SEO padding. Draft articles are deliberately excluded
   as link targets — linking to something that might never get published
   would leave a dangling link. `warnOnUnexpectedInternalLinks` is the
   same non-fatal "trust but verify" check as the citation one, flagging
   any `/articles/` link that doesn't match a real known slug.
3. **Generates a hero photo** (`POE_IMAGE_MODEL`) for the article
   (`src/content/articles/_images/<slug>-hero.<ext>`) — an editorial-style
   lifestyle photograph in a candid, topically-relevant moment (the scene
   hint is chosen from the article's category — see `HERO_SCENE_HINTS` in
   the script). About 1 in 3 hero images is a person-free object/scene
   shot instead of a photo of a woman (`objectOnly` in each category's
   hint); when a person is shown, her ethnicity is chosen explicitly at
   random from a fixed list (`ETHNICITIES`/`randomEthnicity()`) rather
   than left to a vague "diverse" instruction — that wasn't reliably
   producing variety in practice, and every hero image ended up as the
   same ethnicity regardless of the instruction. Non-fatal — a failure
   just means no hero image. These are AI-generated, not real photography
   of a real person — see COMPLIANCE.md.
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

Open the new file in Pages CMS and check:

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

## Newsletter signup (automatic)

The signup boxes on the site post to `/api/subscribe`, a route the
Cloudflare Worker itself handles (`worker/index.ts`) by creating the
contact via Resend's API. No pipeline step needed — this runs whenever a
visitor signs up, independent of publishing. See docs/SETUP.md section 7
for the one-time setup (`RESEND_API_KEY` / `RESEND_AUDIENCE_ID` as Worker
variables).

## 5. Pinterest (`scripts/pipeline/5-pinterest-pin.mjs`)

Two-step, human-gated, same shape as stages 6/7 below:

```bash
# 1. Draft: renders the pin image (article hero photo + gradient scrim +
#    category badge + Poe-drafted headline/subtext + logo, at
#    Pinterest's recommended 1000x1500) and drafts a title/description.
#    Writes both to scripts/pipeline/pinterest-pin-drafts/<slug>.{png,json}.
npm run pipeline:pin -- --slug your-article-slug

# 2. Review the .png and .json (edit either if you want), set
#    "approved": true in the .json, then:
npm run pipeline:pin -- --slug your-article-slug --send
```

`--send` calls Pinterest directly with the image as base64 data — unlike
the old version of this script, it does NOT need the article's image to
already be publicly reachable, so there's no post-deploy timing
dependency. It resolves which board to pin to via `resolveBoardId()` in
`scripts/lib/pinterest.mjs` (category → board from
`scripts/lib/pinterest-boards.json`, falling back to `PINTEREST_BOARD_ID`
for any category without one configured), and on success writes the
resulting pin URL back onto the article's `pinterestPinUrl` field
automatically — no manual Pages CMS step needed.

`.github/workflows/weekly-pinterest-pins.yml` runs the **draft step
only** (never `--send`) every Monday for up to 5 published articles
missing a `pinterestPinUrl`, opening a PR with the generated images/copy.
Pinterest pins have no built-in "unsent draft" state the way Resend
broadcasts do, so a real PR diff — the actual pin image, viewable inline
on GitHub — is the review surface instead. Sending stays a manual, local,
human-run command on purpose, same as every other step in this pipeline
that posts something publicly.

## 6. Reddit engagement (`scripts/pipeline/6-reddit-engagement-draft.mjs`)

Two-step, human-gated by design:

```bash
# 1. Generate a draft comment (writes a JSON file, posts nothing)
npm run pipeline:engage -- --slug your-article-slug

# 2. Review scripts/pipeline/reddit-comment-drafts/your-article-slug.json,
#    edit the text if needed, re-check the subreddit's current rules, and
#    change "approved": false to "approved": true. Then:
npm run pipeline:engage -- --slug your-article-slug --post
```

`--post` records the resulting `redditCommentUrl` back onto the
article's frontmatter automatically.

See [COMPLIANCE.md](COMPLIANCE.md) for why this isn't a single automated
step — drafting is automated (below), posting never is.

`.github/workflows/weekly-reddit-comment-drafts.yml` runs the **draft
step only** every Monday, for up to 5 published articles that have a
`sourceThreadUrl` but no `redditCommentUrl` yet, and opens a PR with the
results (same shape as the Pinterest workflow above). It also hard-skips
any article whose `sourceSubreddit` is on the permanently-excluded list
from `docs/COMPLIANCE.md` (`find-uncommented-articles.mjs`'s
`NEVER_COMMENT_SUBREDDITS`) — that policy applies regardless of whether a
human or a schedule is doing the finding, so it's enforced in code, not
left to review to catch. Requires `POE_API_KEY` as a repository
secret.

## 7. Newsletter broadcast (`scripts/pipeline/7-newsletter-broadcast.mjs`)

Emails subscribers when an article publishes — the "notify people on a
new post" piece that Sender's RSS-to-email automation used to handle,
rewritten against Resend since subscribers now live there (see "Newsletter
signup" above). Same two-step, human-gated pattern as stage 6: nothing
sends until you approve the draft.

```bash
# 1. Draft a subject + teaser with Poe (writes a JSON file, sends nothing)
npm run pipeline:newsletter -- --slug your-article-slug

# 2. Review scripts/pipeline/output/newsletter-broadcast-drafts/your-article-slug.json
#    — edit subject/teaser/html if needed, change "approved": false to
#    "approved": true. Then:
npm run pipeline:newsletter -- --slug your-article-slug --send
```

Requires `RESEND_API_KEY`, `RESEND_AUDIENCE_ID`, and `RESEND_FROM_EMAIL`
in `.env` — see `.env.example` and docs/SETUP.md section 7.
`RESEND_FROM_EMAIL`'s domain must be a verified sending domain in Resend
(Domains → Add Domain in the Resend dashboard, then add the DNS records
it gives you via Cloudflare's DNS tab), or sending will fail.

## 8. Weekly digest (`scripts/pipeline/8-weekly-digest.mjs`)

Lists whatever articles have `status: published` and a `pubDate` in the
last 7 days, sorted newest first, then has Poe draft the actual email
copy for them: a subject line, a one-line intro, and a per-article hook.
Deliberately not the articles' on-page SEO descriptions reused verbatim —
those are written to read well as search snippets, and reusing several of
them back to back in one email tends to read repetitive (see the system
prompt at the top of the script for the exact rules it's drafting under).

Unlike stage 7, there's no local JSON file to approve — the review
checkpoint is Resend itself: this script creates the broadcast with
`send: false`, so it lands as an unsent draft in Resend's dashboard
(Broadcasts tab) — open it there, edit the drafted copy with Resend's own
editor if you want, and send it whenever you're ready.

```bash
npm run pipeline:digest              # respects weeklyDigestEnabled (site.yml)
npm run pipeline:digest -- --force   # run even if the toggle is off
npm run pipeline:digest -- --dry-run # print the drafted subject/intro/hooks, create nothing in Resend
```

Requires `POE_API_KEY` (drafting) in addition to the `RESEND_*` vars
stage 7 uses.

Gated by `weeklyDigestEnabled` in `src/content/settings/site.yml` — off by
default, toggle it via Pages CMS → Site settings (no git needed). Requires
the same `RESEND_API_KEY` / `RESEND_AUDIENCE_ID` / `RESEND_FROM_EMAIL` as
stage 7.

## 9. Internal link backfill (`scripts/pipeline/9-backfill-internal-links.mjs`)

Stage 3's internal-link candidates are whatever else was already
published *when that article was drafted* — an early article can end up
permanently under-linked even once plenty of genuinely relevant articles
exist later. This stage retroactively fixes that: it finds published
articles with fewer than 2 internal links (the same "0-2 is normal, more
reads as SEO padding" norm stage 3 uses), oldest first, and asks Poe to
propose 0-2 new inline links per article against the *current* full list
of other published articles.

Rather than trusting the model to reproduce a whole rewritten article
(risking it subtly altering already-reviewed prose it wasn't asked to
touch), it proposes each addition as an exact `findText` → `replaceText`
pair — a real sentence from the article, verbatim, with a link woven in.
The script only applies an addition if `findText` matches the current
body *exactly once* and `slug` is a real candidate from the list; anything
else is skipped with a warning rather than guessed at. A successful run
also bumps the article's `updatedDate`.

```bash
npm run pipeline:relink                       # up to 5 oldest under-linked articles
npm run pipeline:relink -- --limit 10
npm run pipeline:relink -- --slug some-article-slug   # just one article
```

Requires `POE_API_KEY`. Since this edits already-*published* files
directly (not a new draft), review the diff like any other content
change before merging — see the scheduled workflow below.

## Scheduled automation

`.github/workflows/content-pipeline.yml` runs stages 1–3 daily and, once
`npm run build` still succeeds with the new file(s) added, commits and
pushes up to 3 new drafts (the top 3 candidates that day, fewer if
research turns up less than that) straight to `main` — no PR, no merge
step. Safe specifically because every drafted article is always written
with `status: draft` and `draft: true`, which is what keeps it off the
live site regardless of anything else; landing on `main` just makes it
show up in Pages CMS immediately, instead of sitting invisible on an
unmerged PR branch until someone notices and merges it. If the build
fails (e.g. a malformed draft — Astro validates every article's
frontmatter against the schema at build time, even draft ones), nothing
is committed; today's candidates get reconsidered on a future run via
the same dedup logic that skips already-covered threads. Requires
`POE_API_KEY` (stages 2 and 3 both run on Poe now) to be set as a
repository secret — stage 1 itself needs no Reddit credentials, since it
reads Arctic Shift rather than Reddit's own API. It never touches stages
5, 6, or 7.

`.github/workflows/weekly-digest.yml` runs stage 8 every Monday. It's
always safe to run — `weeklyDigestEnabled` being off, or there being
nothing new to report, both make it a no-op — so unlike the workflow
above, there's nothing to gate it from running unconditionally.

`.github/workflows/weekly-pinterest-pins.yml` runs stage 5's **draft
step only** every Monday, for up to 5 published articles missing a
`pinterestPinUrl`, and opens a PR with the results (see stage 5's section
above for why sending stays manual).

`.github/workflows/weekly-reddit-comment-drafts.yml` runs stage 6's
**draft step only** every Monday, for up to 5 published articles missing
a `redditCommentUrl`, and opens a PR with the results (see stage 6's
section above).

`.github/workflows/weekly-internal-links.yml` runs stage 9 every Monday,
for up to 5 under-linked published articles, and opens a PR with the
resulting edits (see stage 9's section above).

`POE_API_KEY` is required by all of the above and by stage 7 (newsletter
broadcast drafts) — every drafting step in this pipeline goes through
Poe (`scripts/lib/poe.mjs`), not a direct Anthropic client, so there's
one credential for all of it. See `docs/SETUP.md` section 3.

# Content pipeline

End-to-end path from a Reddit thread to a published, promoted article.

## 1. Research (`scripts/pipeline/1-reddit-research.mjs`)

Scans `r/loseit`, `r/xxfitness`, `r/bodyweightfitness`, `r/nutrition`, and
`r/mentalhealth` (edit `TARGET_SUBREDDITS` in the script to change the
list) for recent posts, filters for ones that read like a specific,
recurring, answerable problem (regex heuristics for phrases like "any
recommendations", "how do I", "struggling with"; excludes megathreads and
mod posts), and keeps ones with at least 5 comments as a signal the
question resonates. Writes candidates to
`scripts/pipeline/output/research-<timestamp>.json` (gitignored — this is
working data, not published content).

Reads from [Arctic Shift](https://arctic-shift.photon-reddit.com/)
(`scripts/lib/arcticshift.mjs`), a free third-party Reddit archive, rather
than Reddit's own API — no Reddit app, approval, or account needed for
this stage. See `docs/SETUP.md` for why (Reddit now gates new OAuth
tokens behind manual approval). A real Reddit app is still required for
stage 6's optional comment-posting, since that inherently needs an
authenticated Reddit session — see that section below.

## 2. Product match (`scripts/pipeline/2-product-match.mjs`)

For each pain point, asks Claude to produce a **research brief** — a
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
product record) and asks Claude to write the article in Mindtivate's
editorial voice (see the system prompt in the script). Always writes with
`status: draft` and `draft: true` — the schema in `src/content/config.ts`
defaults to draft too, so a script that forgot to set it would still not
publish.

## Review

Open the new file in Pages CMS (or a PR, if `content-pipeline.yml`
generated it) and check:

- Does it actually answer the researched question?
- Is any product mention accurate, and does the linked product record have
  an approved, correct affiliate URL?
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
opens a PR with any new drafts. It requires `ANTHROPIC_API_KEY` and the
`REDDIT_*` secrets to be set as repository secrets. It never touches
stages 5 or 6 and never merges its own PR.

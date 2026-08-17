# Mindtivate

Evidence-based health and wellness content for women — built with
[Astro](https://astro.build), content-managed with
[Pages CMS](https://pagescms.org), hosted on GitHub Pages.

Mindtivate's editorial process starts from real questions women ask in
communities like r/loseit, r/xxfitness, r/bodyweightfitness, r/nutrition,
and r/mentalhealth, researches an honest answer (including, sometimes, a
specific product), and publishes it with a disclosed affiliate link where
relevant. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full
system and [docs/CONTENT_PIPELINE.md](docs/CONTENT_PIPELINE.md) for how an
article moves from a Reddit thread to a published page.

## Stack

- **[Astro](https://astro.build)** — static site generator, content
  collections for articles/products/authors.
- **[Pages CMS](https://pagescms.org)** — Git-backed CMS UI (config in
  `.pages.yml`) so non-technical editors can write/review without touching
  git directly.
- **GitHub Pages** — hosting, deployed via `.github/workflows/deploy.yml`
  on every push to `main`.
- **Claude (Anthropic API)** — drafts article copy from research briefs.
  See `scripts/lib/claude.mjs`.
- **Sender.net** — newsletter delivery and the "new post" email automation
  (RSS-triggered, no custom integration needed — see `src/pages/rss.xml.js`).

## Getting started

```bash
npm install
npm run dev       # http://localhost:4321
npm run build     # type-check + static build to dist/
npm run preview   # preview the production build
```

Copy `.env.example` to `.env` and fill in credentials before running any of
the `pipeline:*` scripts (see below). The Astro site itself needs no
secrets to build.

## Content pipeline

The automation described in the project brief — research Reddit for
problems, find a product, apply for affiliate, draft the article, publish,
pin to Pinterest, and comment on Reddit — is implemented as a set of small
scripts under `scripts/pipeline/`, run in order:

| Stage | Script | What it does |
|---|---|---|
| 1 | `npm run pipeline:research` | Scans target subreddits for recurring, specific problems. |
| 2 | `npm run pipeline:match` | Turns each pain point into a product research brief (category + search query). |
| — | *(manual)* | A human researches the brief, applies for the affiliate program, and adds/updates a record in `src/content/products/`. |
| 3 | `npm run pipeline:draft` | Drafts an article with Claude from a pain point (+ matched product). Always written as `status: draft`. |
| — | *(manual/CMS)* | Review the draft in Pages CMS, verify the affiliate link, set `status: published`. |
| — | *(CI)* | `deploy.yml` publishes to GitHub Pages on merge to `main`. |
| 5 | `npm run pipeline:pin -- --slug <slug>` | Creates a Pinterest pin linking to the published article. |
| 6 | `npm run pipeline:engage -- --slug <slug>` | Drafts a Reddit comment referencing the article (never auto-posts — see below). |

**Stage 6 requires explicit human approval before anything is posted to
Reddit.** Most of the target subreddits have rules against self-promotion
and link-dropping, and posting without review risks the account and the
site's reputation. Full rationale in
[docs/COMPLIANCE.md](docs/COMPLIANCE.md).

A scheduled GitHub Action (`.github/workflows/content-pipeline.yml`) runs
stages 1–3 weekly and opens a PR with new drafts for review — it never
merges, publishes, pins, or comments on its own.

## Newsletter

The signup form (`src/components/NewsletterSignup.astro`) posts directly to
a Sender.net hosted form. New-post emails are handled by Sender's
RSS-to-email automation pointed at `/rss.xml` — publishing an article is
enough to trigger the email, no extra API call required.

## Project structure

```
src/
  content/         # articles, products, authors, site settings (Pages CMS-managed)
  components/      # Header, Footer, NewsletterSignup, ArticleCard, ProductCallout, ...
  layouts/         # BaseLayout, ArticleLayout
  pages/           # routes: /, /articles, /articles/[slug], /category/[category], ...
  styles/          # global.css (design tokens)
scripts/
  lib/             # small dependency-free API clients (Reddit, Claude, Pinterest, Sender)
  pipeline/        # the numbered pipeline stages described above
docs/              # architecture, content pipeline, compliance, setup
.pages.yml         # Pages CMS collection config
```

## Docs

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — how the pieces fit together.
- [docs/CONTENT_PIPELINE.md](docs/CONTENT_PIPELINE.md) — the editorial pipeline in detail.
- [docs/COMPLIANCE.md](docs/COMPLIANCE.md) — Reddit, FTC/affiliate, and platform-policy notes.
- [docs/SETUP.md](docs/SETUP.md) — step-by-step account/API setup checklist.

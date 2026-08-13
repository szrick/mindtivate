# Architecture

## Overview

```
Reddit (research)  →  pipeline scripts  →  src/content/ (git)  →  Pages CMS (review UI)
                                                   │
                                                   ▼
                                        GitHub Actions (deploy.yml)
                                                   │
                                                   ▼
                                        GitHub Pages (mindtivate.com)
                                                   │
                              ┌────────────────────┼────────────────────┐
                              ▼                    ▼                    ▼
                       Pinterest pin        RSS → Sender.net       Reddit comment
                       (script, manual)     (automatic email)      (script, human-approved)
```

## Site

Astro in static output mode (`astro.config.mjs`). Content lives in three
[content collections](https://docs.astro.build/en/guides/content-collections/)
defined in `src/content/config.ts`:

- **`articles`** — the actual pages under `/articles/[slug]`. Schema
  enforces a `status` (`draft` / `in-review` / `published`) and a `draft`
  boolean; pages only query `status === 'published' && !draft`, so nothing
  half-finished can leak onto the live site even if it's merged to `main`.
- **`products`** — affiliate product records, separate from articles so the
  same product can be referenced from multiple articles and so affiliate
  status (`not-applied` → `applied` → `approved`/`rejected` → `active`) is
  tracked independently of any one article's publish state.
  `ProductCallout.astro` only renders a live affiliate link when
  `affiliateStatus` is `approved` or `active` **and** `affiliateUrl` is set
  — otherwise it renders a "pending review" placeholder, so a half-approved
  product can never accidentally ship a dead or wrong link.
- **`authors`** — bylines.

A fourth, singleton **`settings`** file (`src/content/settings/site.yml`)
holds editable copy (newsletter headline, Sender form URL) that doesn't fit
the collection model.

## Content management

[Pages CMS](https://pagescms.org) reads `.pages.yml` at the repo root and
gives editors a form-based UI over the same markdown files Astro reads —
there's no separate database or export step. It authenticates via GitHub
OAuth and commits directly to the branch you point it at (`main`
recommended, or a review branch if you want a PR step in front of it).

## Deployment

`.github/workflows/deploy.yml` builds the Astro site and publishes it to
GitHub Pages on every push to `main`, using the standard
`actions/configure-pages` + `actions/deploy-pages` flow (no separate hosting
provider or secret needed beyond what Actions provides by default).

`.github/workflows/ci.yml` runs the same build (via `astro check`) on pull
requests and non-main branches, so a broken content edit or component
change fails before merge.

## Automation pipeline

See [CONTENT_PIPELINE.md](CONTENT_PIPELINE.md) for the stage-by-stage
breakdown. In short: research and drafting are safe to fully automate (they
only write files / open a PR); anything that acts on a third-party platform
under the site's identity — posting to Reddit, in particular — has a human
approval gate, for the reasons in [COMPLIANCE.md](COMPLIANCE.md).

## Why no JS framework / CMS backend server

The brief is a content site, not an app: no user accounts, no dynamic
per-request data. Static Astro + a git-backed CMS keeps hosting free
(GitHub Pages), keeps the content in version control (so the pipeline can
write files directly and Pages CMS and git never disagree about what
"published" means), and keeps the attack surface small — there's no server
to compromise.

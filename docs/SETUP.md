# Setup checklist

## 1. Repository & hosting

1. Push this repo to GitHub as `mindtivate` (already done if you're reading
   this from the repo).
2. In **Settings → Pages**, set Source to "GitHub Actions" — `deploy.yml`
   handles the rest on every push to `main`.
3. In **Settings → Pages → Custom domain**, add `mindtivate.com` and follow
   GitHub's DNS instructions (a `CNAME` record to
   `<your-github-username>.github.io`, or the apex `A`/`ALIAS` records
   GitHub documents). Enable "Enforce HTTPS" once the certificate issues.
4. The site is configured for the `mindtivate.com` custom domain root
   (`astro.config.mjs`: `site: 'https://mindtivate.com'`, `base: '/'`;
   `public/CNAME` contains `mindtivate.com`). If DNS hasn't propagated yet
   after adding the custom domain, GitHub Pages will show a "domain does
   not resolve" notice in **Settings → Pages** and the TLS certificate can
   take anywhere from a few minutes to ~24 hours to issue — that's normal,
   not a bug. Once GitHub shows the domain as verified with HTTPS enforced,
   the site should load fully styled.
   - If the custom domain is ever removed and the site reverts to the
     default project URL (`https://szrick.github.io/mindtivate/`), you'd
     need to reverse this: `site: 'https://szrick.github.io'`,
     `base: '/mindtivate/'`, update `public/robots.txt`'s `Sitemap:` line,
     and remove `public/CNAME`.

## 2. Pages CMS

1. Go to [app.pagescms.org](https://app.pagescms.org) and sign in with
   GitHub.
2. Install the Pages CMS GitHub App on the `mindtivate` repo (read/write
   access to this repo only).
3. Add the repo in the Pages CMS dashboard — it will read `.pages.yml`
   automatically and show the Articles / Products / Authors / Site
   settings collections.
4. Invite editors — they'll get the form UI, no git knowledge required.

## 3. Poe — drafting (stages 2, 3, 4, 5, 6, 7, 8)

Every drafting step in the pipeline — product research briefs, article
text, Pinterest pin copy, Reddit comments, newsletter broadcast subjects,
and the weekly digest — goes through Poe (`scripts/lib/poe.mjs`) rather
than calling Anthropic directly, so there's a single API key and a single
bot-selection mechanism for all of it.

1. Create an API key at [poe.com/api_key](https://poe.com/api_key).
2. Locally: add it to `.env` as `POE_API_KEY`, plus:
   - `POE_MODEL` — the bot used for all text drafting (briefs, article
     text, Pinterest/Reddit/newsletter/digest copy). Defaults to
     `Claude-Sonnet-4.5`.
   - `POE_IMAGE_MODEL` — the image-gen bot used for stage 3's hero
     illustration. Defaults to `GPT-Image-1`.
   - `POE_SEARCH_MODEL` — the web-search-capable bot used for stage 3's
     authority-source lookup and its amazon.com product-image search
     (see COMPLIANCE.md — every match is unverified until a human
     confirms it). Defaults to `Web-Search`.
   - `POE_VISION_MODEL` — the vision-capable bot stage 4 (the automated
     editor) uses to check a generated hero image for any visible text
     baked into it. Defaults to `POE_MODEL` (in turn `Claude-Sonnet-4.5`
     if that's unset too — vision-capable already, so this only needs
     setting if you've pointed `POE_MODEL` at something that isn't).
   All four are bot **handles**, not fixed identifiers — check
   [poe.com](https://poe.com) for what's actually available on your
   account/plan and adjust if a default doesn't resolve.
3. For the scheduled GitHub Actions (`content-pipeline.yml`,
   `weekly-digest.yml`, `weekly-pinterest-pins.yml`,
   `weekly-reddit-comment-drafts.yml`, `weekly-internal-links.yml`): add
   repo secret `POE_API_KEY` and, optionally, repo variables `POE_MODEL` /
   `POE_IMAGE_MODEL` / `POE_SEARCH_MODEL` / `POE_VISION_MODEL`.

## 4. Reddit research and (optional) comment posting

These are two separate concerns with two separate setups now.

### Research (stage 1) — nothing to set up

`1-reddit-research.mjs` reads [Arctic Shift](https://arctic-shift.photon-reddit.com/)
(`scripts/lib/arcticshift.mjs`), a free, community-run Pushshift-style
Reddit archive. **No Reddit account, app, or credentials needed** — this
is the default and requires zero setup. Trade-offs worth knowing: it's
third-party community infrastructure (no uptime guarantee) and data can
lag up to ~36 hours behind live Reddit, and it has no "hot" ranking, only
chronological — none of which matters much for a daily research scan.

### Comment posting (stage 6, optional) — requires a real Reddit app

This part is unavoidable: actually posting a comment as a Reddit account
requires a real, authenticated Reddit session. If you want the `--post`
capability on `6-reddit-engagement-draft.mjs`:

**Since late 2025, creating the app is no longer the whole story.** Log in
to the Reddit account you'll use, go to
[reddit.com/prefs/apps](https://www.reddit.com/prefs/apps), and create an
app of type **script** as before — that still works instantly and gives
you a client ID/secret. But actually pulling an OAuth token with those
credentials now requires separate **manual approval** under Reddit's
Responsible Builder Policy (linked on the app-creation page). Registering
the app and being allowed to use it are two different gates now; the
second one is the one that can take time and isn't guaranteed.

1. Create the script app as usual; note the client ID and client secret.
2. Complete Reddit's approval form for API access. Approvals reportedly
   favor **established, clearly-scoped, non-hobby-looking** use cases.
   To maximize the odds:
   - Describe the use case specifically and factually — e.g. "Posts a
     single, human-reviewed comment on mindtivate.com's behalf, linking
     to a researched article, only on threads the article was originally
     sourced from. Every comment is manually approved before posting —
     see mindtivate.com/affiliate-disclosure and
     mindtivate.com/privacy-policy." Avoid vague descriptions like "post
     message."
   - Link a real, live privacy policy — this site already has one at
     `https://mindtivate.com/privacy-policy`, use that.
   - Use a real project identity rather than something that reads as a
     personal/throwaway account.
   - Note: new accounts are limited to one registered app.
3. Add to `.env`: `REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET`,
   `REDDIT_USERNAME`, `REDDIT_PASSWORD`, and a descriptive
   `REDDIT_USER_AGENT` (Reddit rate-limits generic user agents harder).
   `weekly-reddit-comment-drafts.yml` (which runs stage 6's *draft* step
   on a schedule — see `docs/CONTENT_PIPELINE.md`) needs `POE_API_KEY`
   (see section 3) as a repository secret, but **not** these Reddit
   credentials — drafting doesn't touch Reddit's API at all, only
   `--post` does, and that never runs in CI.
4. Read [COMPLIANCE.md](COMPLIANCE.md) before using `--post`.

If approval is slow or denied, the research pipeline keeps working fine
without it — you'd just draft the Reddit comment (`6-reddit-engagement-draft.mjs`
without `--post`) and post it manually through the Reddit website/app
yourself instead of through the script.

## 5. Affiliate programs

There's no single signup — apply to whichever program fits each product
brief from stage 2 (Amazon Associates, ShareASale, Impact, a brand's direct
program, etc.). Once approved:

1. Add/update the product's record in `src/content/products/` (via Pages
   CMS or git).
2. Set `affiliateProgram`, `affiliateStatus: active`, and `affiliateUrl`.
3. `ProductCallout.astro` will start rendering the live link automatically
   on any article that references this product.

## 6. Pinterest

1. Create a Pinterest **business** account for Mindtivate. You can pin
   everything to one board, or create one board per category (Body,
   Food, Mind, Hormones, Love, Beauty, Sleep, Life Stages) — see step 4.
2. Register an app at
   [developers.pinterest.com](https://developers.pinterest.com) and
   generate an access token with `pins:write` and `boards:read` scopes.
3. Add `PINTEREST_ACCESS_TOKEN` and `PINTEREST_BOARD_ID` to `.env`.
   `PINTEREST_BOARD_ID` is the catch-all board — used whenever a category
   has no board of its own configured (step 4).
4. **Optional, per-category boards**: if you created a separate board per
   category, put each board's ID in `scripts/lib/pinterest-boards.json`
   (not secret — an ID, not a credential — so it's a committed file, not
   an env var). A board's ID isn't in its URL; find it via the Pinterest
   API (`GET /v5/boards`) or the board's settings. Leave a category blank
   there to fall back to `PINTEREST_BOARD_ID` for it.
5. For the scheduled drafting workflow
   (`.github/workflows/weekly-pinterest-pins.yml`) to run, add
   `POE_API_KEY` (see section 3) as a repository secret — it's the only
   credential that workflow needs; nothing Pinterest-related runs in CI
   (see `docs/CONTENT_PIPELINE.md`'s Pinterest section for why).

## 7. Resend — newsletter signup + new-article emails

The signup boxes on the site (`NewsletterSignup.astro`, `NewsletterBox.astro`)
post to `/api/subscribe`, a route handled by the Cloudflare Worker itself
(`worker/index.ts` — see `wrangler.jsonc`'s `main`). There's no third-party
hosted form or iframe. Signup is **double opt-in**: the contact is created
in Resend right away but marked unsubscribed (so it can't receive
broadcasts yet), a confirmation email goes out with a signed link, and
only clicking that link (`GET /api/confirm`) flips it to subscribed. The
signature is a stateless HMAC (`CONFIRM_SECRET`) — no database involved,
the link itself carries the email + an expiry, verified on click. Stage 7
of the content pipeline (`scripts/pipeline/7-newsletter-broadcast.mjs`)
then emails that same audience when an article publishes — see
`docs/CONTENT_PIPELINE.md`.

The moment a contact confirms, `worker/index.ts` also fires a 3-email
welcome sequence (Day 0 / 3 / 7) via `ctx.waitUntil` — sent one at a time
using Resend's `scheduled_at` on the Day 3 and Day 7 sends, so there's
nothing to poll or re-trigger later. Edit `WELCOME_SEQUENCE` in
`worker/index.ts` to change the content or timing. Every welcome email
carries an unsubscribe link (`GET /api/unsubscribe`), signed the same way
as the confirmation link but with a 5-year expiry instead of 48 hours,
since it needs to keep working no matter how long the email sits unread.

1. Create a Resend account and an API key at
   [resend.com/api-keys](https://resend.com/api-keys).
2. **Create an Audience** in the Resend dashboard (Audiences → Create
   audience) and copy its ID. This is required — Resend's Broadcasts API
   (what stage 7 uses to send) only reaches contacts that belong to a
   specific audience; a contact created without one is invisible to any
   broadcast. Already set in `wrangler.jsonc`'s `vars.RESEND_AUDIENCE_ID`
   — update that value if you create a different audience.
3. **Verify a sending domain**: Resend dashboard → Domains → Add Domain
   (e.g. `mindtivate.com`, or a subdomain), then add the DNS records it
   gives you via Cloudflare's DNS tab. Sending fails until this is
   verified — including confirmation emails, not just broadcasts.
   `RESEND_FROM_EMAIL` is already set in `wrangler.jsonc`'s `vars`; change
   it if you verify a different domain/address.
4. Set these as **Secrets** on the Worker (Cloudflare dashboard → Workers
   & Pages → mindtivate → Settings → Variables and Secrets — or
   `wrangler secret put <name>` from a machine with Cloudflare CLI
   access). Both are genuine credentials, unlike the audience ID/from
   address above, so neither belongs in `wrangler.jsonc`:
   - `RESEND_API_KEY`
   - `CONFIRM_SECRET` — any long random string; it signs confirmation
     links, so anyone holding it could forge one for an arbitrary email
     address. Generate one with `openssl rand -hex 32` or similar.
5. Set the pipeline's own copies in `.env` (see `.env.example`):
   `RESEND_API_KEY`, `RESEND_AUDIENCE_ID`, and `RESEND_FROM_EMAIL` — the
   Worker and the local pipeline script each need their own copy, one
   runtime doesn't share env with the other. `CONFIRM_SECRET` is Worker-only
   and doesn't belong in `.env` at all — the pipeline script never signs
   or verifies confirmation links.

This replaces Sender.net's **RSS-to-email automation**, which this repo
used previously (see git history for `scripts/lib/sender.mjs` and the
removed `senderFormAction` setting) — that automation emailed *Sender's*
subscriber list, a separate system from Resend. Stage 7 is intentionally
human-gated (draft → review → approve → send) rather than a fully
automatic poll-and-send, matching the rest of the pipeline's approach to
anything that goes out publicly — see `docs/COMPLIANCE.md`.

6. **Weekly digest** (stage 8, optional): `.github/workflows/weekly-digest.yml`
   runs `pipeline:digest` every Monday, gated by `weeklyDigestEnabled` in
   `src/content/settings/site.yml` (toggle via Pages CMS → Site settings
   — off by default). When on, Poe drafts a subject line, a one-line
   intro, and a per-article hook for anything published in the last 7
   days (deliberately not the articles' on-page SEO descriptions — see
   the comment at the top of `8-weekly-digest.mjs`), then it's created as
   an unsent Resend broadcast for you to review and send from Resend's
   dashboard — nothing sends automatically. Needs `POE_API_KEY` (see
   section 3) and `RESEND_API_KEY` as **repository secrets** (Settings → Secrets and
   variables → Actions → Secrets) and `RESEND_AUDIENCE_ID` /
   `RESEND_FROM_EMAIL` as **repository variables** (same page, Variables
   tab) — separate from both the Worker's Cloudflare secrets and your
   local `.env`, since GitHub Actions doesn't share env with either.

## 8. Verify

```bash
npm install
npm run build   # should complete with no errors
npm run preview
```

Then push to `main` (or merge a PR) and confirm the "Deploy to GitHub
Pages" Action succeeds and the domain serves the built site.

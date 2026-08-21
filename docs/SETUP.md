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

## 3. Anthropic (Claude) — Reddit engagement drafts (stage 6, optional)

Only needed if you use `6-reddit-engagement-draft.mjs`. Stages 2 and 3
(product matching and article drafting) run on Poe instead — see below.

1. Create an API key at [console.anthropic.com](https://console.anthropic.com).
2. Locally: add it to `.env` as `ANTHROPIC_API_KEY`.
3. For the scheduled GitHub Action: not needed — `content-pipeline.yml`
   never runs stage 6.

## 3b. Poe — product research briefs & article drafting (stages 2 & 3)

1. Create an API key at [poe.com/api_key](https://poe.com/api_key).
2. Locally: add it to `.env` as `POE_API_KEY`, plus:
   - `POE_MODEL` — the bot used to write briefs and article text. Defaults
     to `Claude-Sonnet-4.5`.
   - `POE_IMAGE_MODEL` — the image-gen bot used for stage 3's hero
     illustration. Defaults to `GPT-Image-1`.
   - `POE_SEARCH_MODEL` — the web-search-capable bot used for stage 3's
     authority-source lookup and its amazon.com product-image search
     (see COMPLIANCE.md — every match is unverified until a human
     confirms it). Defaults to `Web-Search`.
   All three are bot **handles**, not fixed identifiers — check
   [poe.com](https://poe.com) for what's actually available on your
   account/plan and adjust if a default doesn't resolve.
3. For the scheduled GitHub Action: add repo secret `POE_API_KEY` and,
   optionally, repo variables `POE_MODEL` / `POE_IMAGE_MODEL` /
   `POE_SEARCH_MODEL`.

## 4. Reddit research and (optional) comment posting

These are two separate concerns with two separate setups now.

### Research (stage 1) — nothing to set up

`1-reddit-research.mjs` reads [Arctic Shift](https://arctic-shift.photon-reddit.com/)
(`scripts/lib/arcticshift.mjs`), a free, community-run Pushshift-style
Reddit archive. **No Reddit account, app, or credentials needed** — this
is the default and requires zero setup. Trade-offs worth knowing: it's
third-party community infrastructure (no uptime guarantee) and data can
lag up to ~36 hours behind live Reddit, and it has no "hot" ranking, only
chronological — none of which matters much for a weekly research scan.

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
   These are **not** needed by the scheduled Action, which only runs
   stages 1–3 (research/match/draft) — never stage 6.
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

1. Create a Pinterest **business** account for Mindtivate and a board (or
   boards) for your content.
2. Register an app at
   [developers.pinterest.com](https://developers.pinterest.com) and
   generate an access token with `pins:write` and `boards:read` scopes.
3. Add `PINTEREST_ACCESS_TOKEN` and `PINTEREST_BOARD_ID` to `.env`.

## 7. Resend — newsletter signup + new-article emails

The signup boxes on the site (`NewsletterSignup.astro`, `NewsletterBox.astro`)
post to `/api/subscribe`, a route handled by the Cloudflare Worker itself
(`worker/index.ts` — see `wrangler.jsonc`'s `main`), which adds the contact
via Resend's Contacts API. There's no third-party hosted form or iframe.
Stage 7 of the content pipeline
(`scripts/pipeline/7-newsletter-broadcast.mjs`) then emails that same
audience when an article publishes — see `docs/CONTENT_PIPELINE.md`.

1. Create a Resend account and an API key at
   [resend.com/api-keys](https://resend.com/api-keys).
2. **Create an Audience** in the Resend dashboard (Audiences → Create
   audience) and copy its ID (`aud_...`). This is required — Resend's
   Broadcasts API (what stage 7 uses to send) only reaches contacts that
   belong to a specific audience; a contact created without one (an
   earlier version of `worker/index.ts` did this) is invisible to any
   broadcast.
3. **Verify a sending domain**: Resend dashboard → Domains → Add Domain
   (e.g. `mindtivate.com`, or a subdomain), then add the DNS records it
   gives you via Cloudflare's DNS tab. Sending fails until this is
   verified.
4. Set the Worker's copies (Cloudflare dashboard → Workers & Pages →
   mindtivate → Settings → Variables and Secrets):
   - `RESEND_API_KEY` — as a **Secret**.
   - `RESEND_AUDIENCE_ID` — as a plain **Variable** (not secret, it's an
     ID). Add this even if `worker/index.ts` currently reads it as
     optional — without it, new signups go back to being
     broadcast-unreachable.
   - (Or `wrangler secret put RESEND_API_KEY` / edit `wrangler.jsonc`'s
     `vars` for the audience ID, from a machine with Cloudflare CLI
     access.)
5. Set the pipeline's own copies in `.env` (see `.env.example`):
   `RESEND_API_KEY`, `RESEND_AUDIENCE_ID` (same values as above — the
   Worker and the local pipeline script each need their own copy, one
   runtime doesn't share env with the other), and `RESEND_FROM_EMAIL`
   (e.g. `"Mindtivate Insights <insights@mindtivate.com>"`, using the
   domain verified in step 3).

This replaces Sender.net's **RSS-to-email automation**, which this repo
used previously (see git history for `scripts/lib/sender.mjs` and the
removed `senderFormAction` setting) — that automation emailed *Sender's*
subscriber list, a separate system from Resend. Stage 7 is intentionally
human-gated (draft → review → approve → send) rather than a fully
automatic poll-and-send, matching the rest of the pipeline's approach to
anything that goes out publicly — see `docs/COMPLIANCE.md`.

## 8. Verify

```bash
npm install
npm run build   # should complete with no errors
npm run preview
```

Then push to `main` (or merge a PR) and confirm the "Deploy to GitHub
Pages" Action succeeds and the domain serves the built site.

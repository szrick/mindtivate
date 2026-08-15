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

## 3. Anthropic (Claude) — article drafting

1. Create an API key at [console.anthropic.com](https://console.anthropic.com).
2. Locally: add it to `.env` as `ANTHROPIC_API_KEY`.
3. For the scheduled GitHub Action: **Settings → Secrets and variables →
   Actions**, add repo secret `ANTHROPIC_API_KEY`. Optionally add a repo
   **variable** `ANTHROPIC_MODEL` if you want to pin a specific model.

## 4. Reddit — research (+ optional comment posting)

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
   - Describe the use case specifically and factually — e.g. "Automated
     research tool for mindtivate.com: reads posts from a small, fixed
     list of public health/fitness subreddits to identify recurring
     reader questions for article research. Read-only; no posting."
     Avoid vague descriptions like "post message."
   - Link a real, live privacy policy — this site already has one at
     `https://mindtivate.com/privacy-policy`, use that.
   - Use a real project identity rather than something that reads as a
     personal/throwaway account.
   - Note: new accounts are limited to one registered app.
3. Add to `.env`: `REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET`,
   `REDDIT_USERNAME`, `REDDIT_PASSWORD`, and a descriptive
   `REDDIT_USER_AGENT` (Reddit rate-limits generic user agents harder).
4. For the scheduled Action, add the same as repo secrets (research only —
   the Action never posts).
5. Read [COMPLIANCE.md](COMPLIANCE.md) before using `--post` on the
   engagement-draft script.

**If approval is slow, denied, or you'd rather not wait on it:**
[Arctic Shift](https://arctic-shift.photon-reddit.com/) is a free,
actively maintained Pushshift-style archive with a much higher rate limit
(~120,000 req/hour) than similar free services, and needs no Reddit app
or OAuth at all — a reasonable fallback for `1-reddit-research.mjs` if the
official API path stalls. It wasn't wired into the pipeline scripts by
default since it's a third-party community service with its own
reliability tradeoffs, not Reddit's own infrastructure — swap it in if
needed.

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

## 7. Sender.net — newsletter

1. Create a Sender.net account and a subscriber group for the newsletter.
2. Create a hosted signup form, copy its subscribe URL, and set it as
   `senderFormAction` in `src/content/settings/site.yml` (or via Pages CMS
   → Site settings).
3. Create an **RSS-to-email automation** in Sender pointed at
   `https://mindtivate.com/rss.xml`, triggered on new items, sent to the
   subscriber group above. This is what actually emails people when you
   publish — no API credentials needed for this part.
4. Only set `SENDER_API_TOKEN` / `SENDER_GROUP_ID` in `.env` if you plan to
   use `scripts/lib/sender.mjs`'s `addSubscriberToGroup` for a specific
   integration (e.g. adding subscribers from another source).

## 8. Verify

```bash
npm install
npm run build   # should complete with no errors
npm run preview
```

Then push to `main` (or merge a PR) and confirm the "Deploy to GitHub
Pages" Action succeeds and the domain serves the built site.

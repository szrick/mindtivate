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
   - `POE_EDITOR_MODEL` — the bot stage 4 uses to critique the draft and,
     if warranted, rewrite it. Deliberately a stronger/more expensive
     model than `POE_MODEL`'s drafting default is worth it here, since
     this call's entire job is judging another model's writing quality.
     Defaults to `Claude-Opus-4.5`.
   - `POE_INFOGRAPHIC_MODEL` — the image-gen bot stage 5's
     `--style infographic` uses for the illustrated background art (see
     `docs/CONTENT_PIPELINE.md` stage 5). Defaults to `Nano-Banana-2-Lite`.
     Only needed if you use the infographic pin style.
   All six are bot **handles**, not fixed identifiers — check
   [poe.com](https://poe.com) for what's actually available on your
   account/plan and adjust if a default doesn't resolve.
3. For the scheduled GitHub Actions (`content-pipeline.yml`,
   `weekly-digest.yml`, `weekly-pinterest-pins.yml`,
   `weekly-reddit-comment-drafts.yml`, `weekly-internal-links.yml`): add
   repo secret `POE_API_KEY` and, optionally, repo variables `POE_MODEL` /
   `POE_IMAGE_MODEL` / `POE_SEARCH_MODEL` / `POE_VISION_MODEL` /
   `POE_EDITOR_MODEL` / `POE_INFOGRAPHIC_MODEL`.

## 3a. Pexels / Unsplash — real stock photos for hero images (optional)

Without either of these, every hero image is AI-generated (via
`POE_IMAGE_MODEL` above), same as before. Set either or both to mix in
real, licensed photography — roughly half of hero images will try a
stock photo first (randomly Pexels or Unsplash, whichever you've
configured) before falling back to AI generation. See
`scripts/lib/stockphotos.mjs`.

1. **Pexels**: create a free key at
   [pexels.com/api](https://www.pexels.com/api/) (instant approval, no
   attribution legally required by their license — though this site
   credits the photographer anyway). Add to `.env` as `PEXELS_API_KEY`.
2. **Unsplash**: register an app at
   [unsplash.com/developers](https://unsplash.com/developers) and use its
   **Access Key**. Add to `.env` as `UNSPLASH_ACCESS_KEY`. Unlike Pexels,
   Unsplash's [API Guidelines](https://help.unsplash.com/en/articles/2511245)
   *require* crediting the photographer and Unsplash with linked
   attribution on every photo actually used — `ArticleLayout.astro`
   already renders this from the `heroImagePhotographer`/
   `heroImageSource`/etc. fields `stockphotos.mjs` writes, and a
   download-tracking ping fires automatically per their guidelines. New
   Unsplash apps start on the **Demo** tier (50 requests/hour — plenty
   for a few articles a day); apply for **Production** access once
   you're using it for real to raise that limit.
3. For the scheduled `content-pipeline.yml` workflow: add repo secrets
   `PEXELS_API_KEY` / `UNSPLASH_ACCESS_KEY` (optional, independent of
   each other).

## 3b. CJ Affiliate — automated product sourcing (optional)

Without this, stage 2 (`2-product-match.mjs`) only ever produces a
research brief (category + search query) for a human to act on manually,
same as before this existed. With it configured, every brief is first
tried against CJ's Product Search API; a match creates a real product
record automatically — real name, real already-tracked affiliate link,
`affiliateStatus: active` from the start, no manual review step — and
stage 3 binds it straight into the article it was sourced for. See
`scripts/lib/cj.mjs` and `scripts/pipeline/2-product-match.mjs`.

**Important limitation, by design:** CJ's API only ever searches
advertisers your CJ account is already joined and approved for — there is
no API to join a *new* advertiser program, that's a human decision made
in CJ's own dashboard (Advertiser Directory → Apply), and approval is the
advertiser's call, not something a script can do or wait on. When no
already-joined advertiser matches a brief, the brief falls back to manual
research exactly as before, and a short list of CJ-network advertisers
worth considering is appended to
`scripts/pipeline/output/cj-advertisers-to-join.json` (gitignored,
working data only — check it locally, or read the job logs on a GitHub
Actions run).

1. Apply for API access and sign in at
   [developers.cj.com](https://developers.cj.com/) with your CJ Affiliate
   publisher credentials.
2. Create a **Personal Access Token** (Authentication → Personal Access
   Tokens in the developer portal). Add to `.env` as
   `CJ_PERSONAL_ACCESS_TOKEN`.
3. Find your **Company ID** (CID) in your CJ account (Account →
   Account Information, or similar — CJ's UI names/locations shift over
   time). Add to `.env` as `CJ_COMPANY_ID`.
4. For the scheduled `content-pipeline.yml` workflow: add repo secrets
   `CJ_PERSONAL_ACCESS_TOKEN` / `CJ_COMPANY_ID`.
5. Join whichever advertiser programs are relevant to Mindtivate's niche
   in CJ's own dashboard first — auto-sourcing only ever draws from
   advertisers already joined, so the more you've joined, the more briefs
   resolve automatically instead of falling back to manual research.

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

Pins are sent through **Buffer**, not a direct Pinterest API integration
— Buffer is an official Pinterest Marketing Developer Partner with its
own already-Standard (not Trial) API access, so pins go out through
that instead of waiting on this project's own Pinterest app to clear
Pinterest's Trial→Standard review. See `scripts/lib/buffer.mjs`'s header
comment for how this was confirmed against Buffer's live GraphQL API.

1. Create a Pinterest **business** account for Mindtivate. You can pin
   everything to one board, or create one board per category (Body,
   Food, Mind, Hormones, Love, Beauty, Sleep, Life Stages) — see step 3.
2. Create a [Buffer](https://buffer.com) account (the free plan works —
   one API key, ample request quota for this project's volume) and
   connect the Pinterest account from step 1 as a channel in Buffer's
   own dashboard (Settings → Channels — this initial OAuth linking has
   to be done by hand; no API does it). Then generate an API key
   (Buffer's account/developer settings) and add it as `BUFFER_API_KEY`
   in `.env`.
3. **Optional, per-category boards**: if you created a separate board
   per category, put each board's ID in
   `scripts/lib/pinterest-boards.json` (not secret — an ID, not a
   credential — so it's a committed file, not an env var). A board's ID
   isn't in its URL; find it via Buffer's `channel(input:).metadata`
   GraphQL query (see `scripts/lib/buffer.mjs`) or the Pinterest API's
   `GET /v5/boards`. Leave a category blank there to fall back to
   `PINTEREST_BOARD_ID` for it — this is the same board-id value Buffer's
   `boardServiceId` expects, confirmed live (Pinterest's own native board
   id, not any Buffer-internal id).
4. For the scheduled drafting workflow
   (`.github/workflows/weekly-pinterest-pins.yml`) to run, add
   `POE_API_KEY` (see section 3) as a repository secret — that workflow
   only ever drafts, so it's the only credential it needs. By default
   its drafts come out `"approved": true` already (auto-approve is the
   standing default, per explicit decision — see
   `docs/CONTENT_PIPELINE.md`'s Pinterest section); a manual
   `workflow_dispatch` run can set `autoApprove` to `false` to get a
   draft you review before approving by hand instead.
5. **Required for anything to actually reach Pinterest**: add
   `BUFFER_API_KEY` as a repo secret so
   `.github/workflows/pinterest-auto-send.yml` can send whatever's
   `"approved": true` (daily, capped at 5/run) — since drafts
   auto-approve by default, this is what actually gets a pin out, not
   an optional extra. Without it, approved drafts just pile up unsent
   until you run `--send` locally by hand with `BUFFER_API_KEY` set.

A direct Pinterest API integration (`scripts/lib/pinterest.mjs`) still
exists in the repo and is fully working, kept for reference/fallback —
registering a Pinterest app at
[developers.pinterest.com](https://developers.pinterest.com) and
generating your own `PINTEREST_ACCESS_TOKEN` is only needed if you want
to switch off Buffer later (e.g. once this project's own app clears
Pinterest's Trial→Standard review), not for the pipeline as it ships
today.

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
automatic poll-and-send — see `docs/COMPLIANCE.md`. (Stage 5's Pinterest
drafts, by contrast, auto-approve by default per explicit decision — see
section 6 below and `docs/CONTENT_PIPELINE.md`'s Pinterest section.)

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

## 7a. Cloudflare Web Analytics — daily digest email (optional)

A daily email (visits, page views, top pages/referrers/countries/device
types, plus PageSpeed Insights mobile/desktop performance scores) for
the previous UTC day, sent via `.github/workflows/analytics-digest.yml`
(`scripts/pipeline/11-analytics-digest.mjs`). Cookieless and doesn't
identify individual visitors — see `privacy-policy.astro`'s existing
"aggregated analytics" language, which this doesn't change. No
demographics (age/gender) — Cloudflare's analytics doesn't collect that;
see `docs/CONTENT_PIPELINE.md` if you need that instead.

1. **Enable Web Analytics for the site**: Cloudflare dashboard → **Analytics
   & Logs** → **Web Analytics** → **Add a site** → enter `mindtivate.com`.
   This generates a JS snippet containing a **token** — copy just the
   token value (the part inside `data-cf-beacon='{"token": "..."}'`).
2. Add that token to `.env` as `PUBLIC_CF_BEACON_TOKEN` (the `PUBLIC_`
   prefix is required — Astro only exposes `PUBLIC_`-prefixed vars to the
   browser build; this one has to reach the browser to work at all, and
   isn't a credential — it's a public identifier baked into every page's
   HTML by design, same as a Google Analytics measurement ID). Without
   this set, `BaseLayout.astro` simply omits the beacon script — the site
   builds and works fine either way.
3. On the same Web Analytics page, note the site's **Zone/Site tag** —
   Cloudflare shows this once the site's been added (a 32-character hex
   ID, distinct from the beacon token). Add to `.env` as `CF_SITE_TAG`.
4. Find your **Account tag/ID**: Cloudflare dashboard → any domain →
   right sidebar shows "Account ID". Add to `.env` as `CF_ACCOUNT_TAG`.
5. Create an API token: **My Profile → API Tokens → Create Token** →
   custom token with **Account → Account Analytics → Read** permission,
   scoped to your account. Add to `.env` as `CF_API_TOKEN`.
6. Decide where the digest should land and add to `.env` as
   `ANALYTICS_DIGEST_EMAIL` — any inbox you actually check, doesn't need
   to be an address this site otherwise sends from.
7. For the scheduled workflow: add repo secrets `CF_API_TOKEN`,
   `CF_ACCOUNT_TAG`, `CF_SITE_TAG`, `ANALYTICS_DIGEST_EMAIL`, and
   `RESEND_API_KEY` (see section 7) if not already set, plus repo
   variable `RESEND_FROM_EMAIL` (also section 7). Runs daily at 23:00
   UTC (07:00 HKT the next morning); `workflow_dispatch` also accepts an
   optional `date` input to re-run a specific day manually.
7a-i. **PageSpeed Insights scores (optional secret)**: the digest also
   fetches mobile/desktop performance scores for the site root from
   Google's PageSpeed Insights API. This works with no setup at all — it
   runs unauthenticated against a shared, low-volume Google quota, which
   is plenty for the 2 requests/day this needs. If that ever starts
   getting rate-limited, get a free API key: Google Cloud Console → a
   project → **APIs & Services → Library** → enable **PageSpeed Insights
   API** → **Credentials** → **Create credentials → API key**. Add it as
   repo secret `PAGESPEED_API_KEY`. If this section fails on a given day
   (Google's API is known to occasionally time out), the rest of the
   digest still sends — that section just reports itself unavailable.
8. **Rebuild and redeploy** after setting `PUBLIC_CF_BEACON_TOKEN` — it's
   baked in at build time, so an existing deployed site won't start
   collecting analytics until the next build picks up the new var (set
   it as a build-time environment variable in whatever's running
   `npm run build` for the live deploy — check your Cloudflare Workers
   project's build settings, not just local `.env`, since that's what
   actually reaches production).

## 7b. YouTube Shorts — automated video drafting (optional)

Stage 12 (`scripts/pipeline/12-youtube-short.mjs`) turns a published
article into a vertical Short, typically 15-30s: Poe writes a short
2-beat, open-loop script (a hook left deliberately unresolved, then a
CTA naming mindtivate.com), ElevenLabs voices each beat separately,
Pexels/Pixabay supply B-roll per beat, ffmpeg assembles each beat as its
own self-contained clip (audio + video + burned-in captions) and
concatenates them, and the result uploads straight to YouTube as a
**private** video — nothing is public until a human watches the private
upload and approves it (see `docs/COMPLIANCE.md`'s YouTube section).

1. **ElevenLabs** (voiceover): create an account at
   [elevenlabs.io](https://elevenlabs.io) and get an API key under
   **Settings → API Keys**. Add to `.env` as `ELEVENLABS_API_KEY`. Pick a
   voice from the [Voice Library](https://elevenlabs.io/app/voice-library)
   (any premade voice works to start) and copy its voice ID into `.env`
   as `ELEVENLABS_VOICE_ID`. The free tier has a monthly character quota —
   check ElevenLabs' current pricing before drafting a large batch of
   articles at once; a paid tier is likely needed for anything beyond a
   handful of Shorts a month.
2. **Pexels** (B-roll, primary source): same key as section 3a's hero
   photos if you already set that up — `PEXELS_API_KEY` works for both
   Pexels' photo and video search endpoints. If you skipped section 3a,
   get a free key at [pexels.com/api](https://www.pexels.com/api/)
   (instant approval).
3. **Pixabay** (B-roll, fallback source): create a free key at
   [pixabay.com/api/docs](https://pixabay.com/api/docs/) (instant, no
   approval wait). Add to `.env` as `PIXABAY_API_KEY`. Without either
   Pexels or Pixabay configured, every beat falls back to a plain
   branded card instead of real footage — see `renderFallbackFrame` in
   `12-youtube-short.mjs`.
4. **YouTube Data API v3** (upload): this is the multi-step one, since it
   needs a real OAuth app and a one-time authorization against your
   actual channel.
   1. Go to [console.cloud.google.com](https://console.cloud.google.com),
      create a new project (or reuse an existing one).
   2. **APIs & Services → Library** → search "YouTube Data API v3" →
      **Enable**.
   3. **APIs & Services → Google Auth Platform** (Google restructured the
      old single-page "OAuth consent screen" into three tabs here —
      Branding/Audience/Clients — sometime in 2024; if your console still
      shows the old single-page form, the equivalent steps are the same,
      just not split across tabs). Under **Audience**: choose **External**
      (unless you have a Google Workspace org to use Internal), and add
      your own Google account under **Test users → + Add users**
      (required while the app is in "Testing" status — it doesn't need
      Google's review/verification for personal use like this, since only
      accounts you explicitly add as test users can authorize it; trying
      to authorize with an account not on this list fails with "Error
      403: access_denied"). Under **Branding** (not Audience), fill in
      the required app info. The scope
      `https://www.googleapis.com/auth/youtube.upload` is requested by
      `youtube-oauth-setup.mjs` itself at authorization time — nothing to
      configure for it here on current console versions, though older
      versions required adding it explicitly under a "Scopes" section.
   4. **APIs & Services → Credentials → Create Credentials → OAuth client
      ID** → Application type **Desktop app** (not "Web application" —
      Desktop app clients can use any `http://localhost:<port>` redirect
      without pre-registering the exact port, which is what lets the
      next step pick one itself). Copy the **Client ID** and **Client
      secret** into `.env` as `YOUTUBE_CLIENT_ID` / `YOUTUBE_CLIENT_SECRET`.
   5. Run `node scripts/pipeline/youtube-oauth-setup.mjs` locally. It
      prints a Google authorization URL — open it in a browser signed in
      to the Google account that owns (or manages) your YouTube channel,
      approve access, and the script prints a refresh token. Add that as
      `.env`'s `YOUTUBE_REFRESH_TOKEN` (and the repo secret of the same
      name — see below). This step can't be scripted further than this;
      it needs a real person clicking "Allow" once.
   6. The script requests the `youtube.force-ssl` scope (broader than
      just upload) so the pipeline can also set a custom thumbnail (see
      below) — if `YOUTUBE_REFRESH_TOKEN` was issued by an older version
      of this script that only requested `youtube.upload`, custom
      thumbnails will fail with an insufficient-scope error until you
      re-run `youtube-oauth-setup.mjs` and replace the secret with a
      freshly issued token. A refresh token is locked to the scope it
      was issued with — there's no way to widen one after the fact.
5. **Custom thumbnails** (optional, non-fatal if skipped): stage 12 also
   has Poe write a thumbnail concept (`POE_THUMBNAIL_CONCEPT_MODEL`,
   defaults to `Gemini-3.5-Flash`) and generate the actual image via
   a Poe image-gen bot (`POE_THUMBNAIL_IMAGE_MODEL`, defaults to Poe's
   Nano-Banana-2-Lite, the same bot handle section 3's `POE_INFOGRAPHIC_MODEL`
   already uses — check poe.com/explore if the handle ever changes).
   Setting it requires your YouTube channel
   to have **"Additional features"** phone-number verification enabled
   (**youtube.com/verify**) — an unverified channel gets a clear API
   error back, not a silent no-op; the draft's `.json` records
   `thumbnailSet: false` and `thumbnailError` when this happens, and the
   video keeps YouTube's own auto-generated thumbnail instead.
6. For the scheduled workflows (`weekly-youtube-shorts.yml`,
   `youtube-auto-publish.yml`): add repo secrets `ELEVENLABS_API_KEY`,
   `ELEVENLABS_VOICE_ID`, `PEXELS_API_KEY`, `PIXABAY_API_KEY`,
   `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET`, `YOUTUBE_REFRESH_TOKEN`,
   and (if using custom thumbnails) `POE_THUMBNAIL_CONCEPT_MODEL` /
   `POE_THUMBNAIL_IMAGE_MODEL` (plus `POE_API_KEY`, already needed for
   section 3). Unlike Pinterest's `autoApprove` default,
   `weekly-youtube-shorts.yml` defaults `autoApprove` to **false** —
   watch the first several private uploads on youtube.com yourself
   before trusting this format unattended.
7. YouTube Data API's free daily quota (10,000 units) caps real publishes
   at roughly 6/day (`MAX_PUBLISHES_PER_RUN` in `12-youtube-short.mjs`
   stays under that) — a hard platform ceiling, not a tunable preference.
   Raise it only by requesting a quota increase from Google, a review
   process that can take days.

## 8. Verify

```bash
npm install
npm run build   # should complete with no errors
npm run preview
```

Then push to `main` (or merge a PR) and confirm the "Deploy to GitHub
Pages" Action succeeds and the domain serves the built site.

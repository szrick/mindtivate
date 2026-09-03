# Compliance notes

This system touches several platforms with their own rules. This is not
legal advice — read the current terms for each platform/program before
relying on any of this — but it documents the constraints the pipeline was
designed around.

## Reddit

- **Self-promotion.** Reddit's site-wide rules and most subreddit rules
  restrict posting your own content. Stage 1 now scans 5 subreddits per
  site category (`DEFAULT_SUBREDDITS_BY_CATEGORY` in
  `1-reddit-research.mjs`, 40 total) — too many to keep an individually
  audited list current here, so the default policy is: **treat every one
  of them as research-only until its current rules and mod culture have
  actually been checked**, the same posture stage 6 already requires
  before `--post` does anything (see below). Never assume a subreddit is
  promo-friendly just because it's in the default list; that list is
  about finding real recurring questions, not vetted commenting targets.
  - Extra caution, not just the default posture: subreddits centered on
    mental health or emotionally vulnerable situations — r/mentalhealth,
    r/Anxiety (Mind), r/relationship_advice (Love), r/PCOS,
    r/Menopause, r/WomensHealth (Hormones) — warrant treating as
    research-only *permanently*, not just until checked: do not comment
    there with a product or article link at all. A wrong or pushy reply
    in a vulnerable-user context risks real harm, not just a ban.
  - r/xxfitness and r/nutrition (long-standing in this list) are known
    to moderate heavily against promotional/low-effort content; comments
    there need to stand on their own as a real answer.
  - Check each subreddit's current rules before commenting — they change,
    and rules are enforced per-subreddit, not uniformly.
- **Why stage 6 is human-gated.** `scripts/pipeline/6-reddit-engagement-draft.mjs`
  always writes a draft first and requires a human to set `"approved":
  true` in the draft file before `--post` will do anything. An LLM cannot
  reliably judge a specific subreddit's current mood, a specific thread's
  context, or whether a moderator has already flagged similar comments as
  spam — a human reviewing each comment before it goes out is the
  difference between "helpful answer that happens to link to more detail"
  and "spam that gets the account banned." `weekly-reddit-comment-drafts.yml`
  automates the *drafting* half on a schedule (opens a PR so reviewing
  means reading the comment text in a diff and merging, rather than
  running the script by hand) — it never runs `--post`, and it hard-skips
  the permanently research-only subreddits listed above rather than
  relying on review to catch one.
- **Vote/comment manipulation.** Never use multiple accounts to
  upvote/reply to your own content, and don't post the same comment across
  many threads — that's manipulation under Reddit's rules regardless of
  how the comment reads individually.

## FTC / affiliate disclosure

- The FTC's Endorsement Guides require a clear, conspicuous disclosure
  whenever a link could result in compensation. This project handles that
  three ways:
  1. `AffiliateDisclosure.astro` renders a banner near the top of every
     article.
  2. `ProductCallout.astro` renders a per-recommendation disclosure line
     next to any live affiliate link.
  3. `/affiliate-disclosure` is a standing page linked from the footer of
     every page.
- Disclose in the Reddit comment too if it links to an article containing
  affiliate links — don't rely on the reader clicking through to find the
  disclosure. Keep it short and honest ("we researched this and the
  article has an affiliate link to the product mentioned").
- Never present an affiliate link as a "neutral" recommendation. The
  `disclosureRequired` field on product records exists so this isn't
  optional per-product.

## Affiliate program terms

- Most affiliate programs (Amazon Associates in particular) prohibit
  posting the raw affiliate link directly into forum comments, social
  posts, or anywhere outside an approved website — check the specific
  program's operating agreement. That's *why* the Reddit comment and the
  Pinterest pin both link to the **Mindtivate article**, never directly to
  an affiliate URL.
- `affiliateStatus` on a product record must reach `approved` or `active`
  before `ProductCallout.astro` will render a link at all — don't hand-edit
  around this in content.

## Pinterest

- Only pin your own content to boards you own, with an honest title and
  description (no clickbait/misleading claims) — Pinterest's spam policy
  covers both volume and misleading content. Pin at a sustainable rate
  (a handful of new pins around publish time, not a scripted bulk-pin
  loop) rather than trying to maximize post frequency.

## Newsletter / email

- Sender.net (like any ESP) requires consent-based opt-in and a working
  unsubscribe link — the hosted form used in `NewsletterSignup.astro`
  handles both. Don't use `addSubscriberToGroup` in
  `scripts/lib/sender.mjs` to add anyone who didn't explicitly submit the
  form.
- CAN-SPAM / GDPR-style basics apply: identify the sender, don't use a
  deceptive subject line, honor unsubscribes promptly — all standard
  Sender.net defaults, but worth confirming in your Sender account
  settings.

## Content honesty

- Nothing on the site should present AI-drafted content as a personal
  anecdote from a named individual who didn't write it. Bylines use the
  `mindtivate-team` author record for exactly this reason — see
  `src/content/authors/mindtivate-team.md`.
- AI-drafted articles go through a human review step before
  `status: published` (see CONTENT_PIPELINE.md) specifically to catch
  factual errors, overclaiming, or a product mention that doesn't actually
  fit — automation drafts, a human is accountable for what ships.
- **Product images are sourced from amazon.com, and every one is an
  unverified match until a human confirms it.** `3-generate-article.mjs`
  uses a Poe search bot to find a real amazon.com listing for a product
  record with no image, downloads that listing's photo, and rehosts it as
  a static asset in this repo — flagged in the product file's frontmatter
  as an unverified match, with the matched listing title/URL when
  available. Two risks this creates, both requiring a human check before
  publishing:
  - **Wrong match.** The search can return a similar-but-different
    product. Confirm it's the exact item before applying for the
    affiliate program.
  - **Rehosting risk.** This downloads and re-serves a marketplace image
    outside Amazon's Product Advertising API, which is the officially
    sanctioned way to use their product imagery under the Associates
    Program Operating Agreement. Treat a flagged image as a placeholder
    to replace with an API-sourced or manufacturer-provided image before
    `affiliateStatus` reaches `approved`/`active` on a real, live link.
- **Article hero photos are either AI-generated or a real, licensed
  stock photo — check `heroImageSource` in the article's frontmatter to
  tell which.** When unset, `3-generate-article.mjs` generated the image
  via Poe rather than sourcing real photography, and the same caveat as
  before applies: this is lower-stakes than the product-image case
  above — a hero photo isn't claiming to depict a specific real customer
  or reader the way a product photo claims to depict a specific real
  item — but don't caption or reference it in a way that implies it's a
  real person's photo (e.g. a testimonial), and reviewers should
  sanity-check it doesn't have obvious AI-image artifacts (distorted
  hands/faces) that would look unprofessional on a live article. When
  `heroImageSource` is `Pexels` or `Unsplash` (`scripts/lib/stockphotos.mjs`),
  it's a real, licensed photo — no AI-artifact concern, but Unsplash's
  API terms require the photographer/Unsplash credit line
  `ArticleLayout.astro` renders from `heroImagePhotographer`/
  `heroImageSource`/etc.; don't strip those fields from an
  Unsplash-sourced article without also removing the image, and be aware
  a Pages CMS field not declared in `.pages.yml` gets silently dropped on
  save (this happened to `heroImageAlt` once already) — all the
  attribution fields are declared there specifically to avoid a repeat.

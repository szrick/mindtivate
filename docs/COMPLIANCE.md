# Compliance notes

This system touches several platforms with their own rules. This is not
legal advice — read the current terms for each platform/program before
relying on any of this — but it documents the constraints the pipeline was
designed around.

## Reddit

- **Self-promotion.** Reddit's site-wide rules and most subreddit rules
  restrict posting your own content, and several target subreddits go
  further:
  - r/xxfitness and r/loseit moderate heavily against promotional content
    and low-effort links; both expect comments to stand on their own as a
    real answer.
  - r/bodyweightfitness and r/nutrition have wiki/FAQ-first cultures and
    are quick to remove anything that reads as an ad.
  - r/mentalhealth is stricter still — treat it as research-only (read what
    people struggle with) and do not comment there with a product or
    article link at all; mental-health communities are a poor fit for
    promotional replies regardless of platform rules, and a wrong or
    pushy reply in a vulnerable-user context risks real harm, not just a
    ban.
  - Check each subreddit's current rules before commenting — they change,
    and rules are enforced per-subreddit, not uniformly.
- **Why stage 6 is human-gated.** `scripts/pipeline/6-reddit-engagement-draft.mjs`
  always writes a draft first and requires a human to set `"approved":
  true` in the draft file before `--post` will do anything. An LLM cannot
  reliably judge a specific subreddit's current mood, a specific thread's
  context, or whether a moderator has already flagged similar comments as
  spam — a human reviewing each comment before it goes out is the
  difference between "helpful answer that happens to link to more detail"
  and "spam that gets the account banned."
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
- **AI-generated product images are placeholders, never a substitute for a
  real product photo.** `3-generate-article.mjs` may generate a product
  image via Poe when a product record has none, and marks it in the
  file's frontmatter as an AI-generated placeholder for exactly this
  reason. Showing readers a fabricated image next to a real affiliate
  link misrepresents what they'd actually receive — treat a flagged
  placeholder as a blocker on `affiliateStatus` reaching `approved`/
  `active` until it's replaced with a genuine photo of the product.

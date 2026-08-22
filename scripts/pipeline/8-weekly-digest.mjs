#!/usr/bin/env node
// Stage 8: weekly digest of newly-published articles, drafted (never sent)
// as a Resend Broadcast.
//
// Unlike stage 7 (one broadcast per article, drafted to a local JSON file
// for approval), the "review before it goes out" step here happens
// directly in Resend's own dashboard instead of a local file: this
// script creates the broadcast with send:false, and a human opens Resend
// (Broadcasts tab), edits it if they want, and hits Send themselves.
//
// Poe drafts the actual email copy (subject, one-line intro, and a
// per-article hook) — deliberately NOT the articles' on-page SEO
// descriptions verbatim. Those are written to read well as search
// snippets; email needs a real subject-line hook instead of a "New this
// week: X" label, and hooks that read fresh next to each other rather
// than N descriptions all in the same "here's what actually changes"
// mold the article-drafting pipeline tends to produce.
//
// Gated by `weeklyDigestEnabled` in src/content/settings/site.yml (toggle
// via Pages CMS → Site settings) so the scheduled GitHub Action can run
// every week unconditionally without asking anyone — it's a safe no-op
// until that's turned on, and a safe no-op again on any week with nothing
// new to report.
//
// Usage:
//   npm run pipeline:digest              # respects weeklyDigestEnabled
//   npm run pipeline:digest -- --force   # ignore the toggle (manual testing)
//   npm run pipeline:digest -- --dry-run # print the drafted copy, create nothing in Resend

import { readdirSync, readFileSync } from 'node:fs';
import { loadEnv } from '../lib/env.mjs';
import { parseFlatYaml, readFrontmatter } from '../lib/frontmatter.mjs';
import { createBroadcast } from '../lib/resend.mjs';
import { askPoeForJson } from '../lib/poe.mjs';

loadEnv();

const ARTICLES_DIR = 'src/content/articles';
const SETTINGS_PATH = 'src/content/settings/site.yml';
const SITE_URL = 'https://mindtivate.com';
const WINDOW_DAYS = 7;

const SYSTEM_PROMPT = `You write a short weekly newsletter email for Mindtivate, an evidence-based
women's health/wellness site — specific and grounded, never hype-y or
diet-culture. You're given this week's newly-published articles (title,
category, and each one's on-page SEO description). Write fresh copy for
the EMAIL — do not reuse an SEO description verbatim, and don't write in
that same "here's what actually X" template for every article; vary the
phrasing so the hooks don't all sound alike next to each other.

Rules:
- Subject: specific and genuinely intriguing — built from the real
  tension/question in the single strongest article this week (pick one,
  don't try to summarize all of them). Not generic hype ("You won't
  believe...", "This one trick") and not a label like "New this week: X".
  Under 60 characters.
- Intro: one short, warm, human sentence introducing the week's read(s).
  No "Hi there", no sign-off, no mention of "this newsletter" or "this
  email".
- Per-article hook: one short sentence per article (2 max), building
  curiosity about what's actually in the piece without giving the answer
  away or overselling it. Second person where it reads naturally. No
  "click here" / "read more" — that's a separate button already.
- No medical claims, no "shocking" / "secret" / "amazing" language.
- Do not mention that you are an AI or that this was generated.

Output strict JSON only, with one hook per article in the same order
given: {"subject": "...", "intro": "...", "articles": [{"slug": "...", "hook": "..."}]}`;

function parseArgs(argv) {
  const args = { force: false, dryRun: false };
  for (const arg of argv) {
    if (arg === '--force') args.force = true;
    else if (arg === '--dry-run') args.dryRun = true;
  }
  return args;
}

function listRecentPublishedArticles(days) {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const articles = [];
  for (const file of readdirSync(ARTICLES_DIR)) {
    if (!file.endsWith('.md')) continue;
    const { data } = readFrontmatter(readFileSync(`${ARTICLES_DIR}/${file}`, 'utf8'));
    if (data.status !== 'published') continue;
    const pubDate = new Date(data.pubDate);
    if (Number.isNaN(pubDate.getTime()) || pubDate.getTime() < cutoff) continue;
    articles.push({
      slug: file.replace(/\.md$/, ''),
      title: data.title,
      description: data.description,
      category: data.category,
      pubDate,
    });
  }
  articles.sort((a, b) => b.pubDate - a.pubDate);
  return articles;
}

// Merges Poe's per-slug hooks back onto the article list. Falls back to
// the on-page description for any slug the response is missing (a
// truncated/malformed response shouldn't silently drop an article from
// the digest) rather than throwing.
function attachHooks(articles, draftedArticles) {
  const hookBySlug = new Map((draftedArticles ?? []).map((a) => [a.slug, a.hook]));
  return articles.map((a) => ({ ...a, hook: hookBySlug.get(a.slug) || a.description }));
}

function renderHtml({ intro, articles }) {
  const cards = articles
    .map(({ title, hook, category, slug }) => {
      const link = `${SITE_URL}/articles/${slug}/`;
      return `<tr>
        <td style="padding:0 0 1.6em;">
          <p style="margin:0 0 0.3em;font-size:12px;letter-spacing:0.04em;text-transform:uppercase;color:#5f7457;font-family:Arial,sans-serif;">${category}</p>
          <h2 style="margin:0 0 0.4em;font-size:19px;line-height:1.35;color:#2f2a33;"><a href="${link}" style="color:#2f2a33;text-decoration:none;">${title}</a></h2>
          <p style="margin:0 0 0.5em;font-size:15px;line-height:1.6;color:#55505c;">${hook}</p>
          <a href="${link}" style="font-size:14px;font-family:Arial,sans-serif;font-weight:bold;color:#d97a5f;text-decoration:none;">Read the full breakdown →</a>
        </td>
      </tr>`;
    })
    .join('\n');

  return `<!doctype html>
<html>
  <body style="margin:0;padding:32px 24px;background:#fbf6ef;font-family:Georgia,serif;">
    <div style="max-width:560px;margin:0 auto;">
      <p style="margin:0 0 1.5em;font-size:13px;letter-spacing:0.04em;text-transform:uppercase;color:#5f7457;font-family:Arial,sans-serif;">Mindtivate Insights — this week</p>
      <p style="margin:0 0 1.6em;font-size:16px;line-height:1.6;color:#2f2a33;">${intro}</p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        ${cards}
      </table>
    </div>
  </body>
</html>`;
}

function renderText({ intro, articles }) {
  const list = articles
    .map(({ title, hook, slug }) => `${title}\n${hook}\n${SITE_URL}/articles/${slug}/`)
    .join('\n\n');
  return `${intro}\n\n${list}`;
}

async function run() {
  const args = parseArgs(process.argv.slice(2));

  const settings = parseFlatYaml(readFileSync(SETTINGS_PATH, 'utf8'));
  if (!args.force && settings.weeklyDigestEnabled !== true) {
    console.log('weeklyDigestEnabled is off in site.yml (Pages CMS → Site settings) — skipping. Use --force to override.');
    return;
  }

  const articles = listRecentPublishedArticles(WINDOW_DAYS);
  if (articles.length === 0) {
    console.log(`No published articles in the last ${WINDOW_DAYS} days — nothing to digest.`);
    return;
  }

  console.log(`Drafting copy for ${articles.length} article(s) with Poe...`);
  const draft = await askPoeForJson({
    system: SYSTEM_PROMPT,
    prompt: `This week's articles, in order:\n\n${articles
      .map((a, i) => `${i + 1}. Slug: ${a.slug}\n   Title: "${a.title}"\n   Category: ${a.category}\n   SEO description: ${a.description}`)
      .join('\n\n')}`,
    maxTokens: 1000,
  });

  const subject = draft.subject;
  const articlesWithHooks = attachHooks(articles, draft.articles);
  const html = renderHtml({ intro: draft.intro, articles: articlesWithHooks });
  const text = renderText({ intro: draft.intro, articles: articlesWithHooks });

  console.log(`\nSubject: "${subject}"`);
  console.log(`Intro: ${draft.intro}`);
  for (const a of articlesWithHooks) console.log(`  - [${a.category}] ${a.title}\n    ${a.hook}`);

  if (args.dryRun) {
    console.log('\n--dry-run: not creating a Resend draft.');
    return;
  }

  const from = process.env.RESEND_FROM_EMAIL;
  if (!from) throw new Error('Missing required env var: RESEND_FROM_EMAIL (e.g. "Mindtivate Insights <insights@mindtivate.com>")');

  const result = await createBroadcast({
    from,
    subject,
    html,
    text,
    name: `Weekly digest — ${new Date().toISOString().slice(0, 10)}`,
    send: false,
  });
  console.log(`\nDraft created in Resend (id: ${result.id ?? 'unknown'}).`);
  console.log('Open Resend → Broadcasts to review, edit, and send it.');
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

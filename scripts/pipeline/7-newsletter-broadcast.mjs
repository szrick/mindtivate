#!/usr/bin/env node
// Stage 7: draft and send a "new article" newsletter broadcast via Resend.
//
// Two-step, human-gated by design (same pattern as stage 6's Reddit
// engagement drafts — see docs/COMPLIANCE.md): this script never sends on
// its first run. It writes a draft to
// scripts/pipeline/output/newsletter-broadcast-drafts/<slug>.json with
// "approved": false. A human must open that file, edit the subject/teaser
// if needed, and change it to "approved": true before `--send` will do
// anything.
//
// Usage:
//   npm run pipeline:newsletter -- --slug some-article-slug          # draft only
//   npm run pipeline:newsletter -- --slug some-article-slug --send    # send, only if approved

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { loadEnv } from '../lib/env.mjs';
import { askClaudeForJson } from '../lib/claude.mjs';
import { readFrontmatter } from '../lib/frontmatter.mjs';
import { createBroadcast } from '../lib/resend.mjs';

loadEnv();

const DRAFTS_DIR = 'scripts/pipeline/output/newsletter-broadcast-drafts';
const SITE_URL = 'https://mindtivate.com';

const SYSTEM_PROMPT = `You write a short newsletter email announcing a new Mindtivate article to
subscribers. Mindtivate is an evidence-based women's health/wellness site
— specific and grounded, never hype-y or diet-culture. Rules:
- Subject line: specific and genuinely intriguing — the actual question
  or tension the article addresses, not generic hype ("You won't
  believe...", "This one trick"). Under 60 characters.
- Teaser: 2-4 short sentences, plain text, no markdown, no greeting
  ("Hi there"), no sign-off. Open with the real question/tension the
  article answers. Make clear there's a specific, researched answer worth
  reading without giving the whole answer away — intriguing, not coy or
  clickbait.
- No medical claims, no "shocking"/"secret"/"amazing" language.
- Do not mention that you are an AI or that this was generated.
Output strict JSON only: {"subject": "...", "teaser": "..."}`;

function parseArgs(argv) {
  const args = { send: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--slug') args.slug = argv[++i];
    else if (argv[i] === '--send') args.send = true;
  }
  return args;
}

function renderHtml({ title, teaser, link }) {
  const paragraphs = teaser
    .split(/\n+/)
    .filter(Boolean)
    .map((p) => `<p style="margin:0 0 1em;font-size:16px;line-height:1.6;color:#2f2a33;">${p}</p>`)
    .join('\n');
  return `<!doctype html>
<html>
  <body style="margin:0;padding:32px 24px;background:#fbf6ef;font-family:Georgia,serif;">
    <div style="max-width:560px;margin:0 auto;">
      <p style="margin:0 0 1.5em;font-size:13px;letter-spacing:0.04em;text-transform:uppercase;color:#5f7457;font-family:Arial,sans-serif;">Mindtivate Insights</p>
      <h1 style="margin:0 0 0.6em;font-size:24px;line-height:1.25;color:#2f2a33;">${title}</h1>
      ${paragraphs}
      <p style="margin:1.5em 0 0;">
        <a href="${link}" style="display:inline-block;padding:0.85em 1.6em;border-radius:999px;background:#d97a5f;color:#ffffff;text-decoration:none;font-family:Arial,sans-serif;font-weight:bold;font-size:15px;">Read the full article</a>
      </p>
    </div>
  </body>
</html>`;
}

function renderText({ title, teaser, link }) {
  return `${title}\n\n${teaser}\n\nRead the full article: ${link}`;
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.slug) {
    console.error('Usage: npm run pipeline:newsletter -- --slug <article-slug> [--send]');
    process.exitCode = 1;
    return;
  }

  const articlePath = `src/content/articles/${args.slug}.md`;
  if (!existsSync(articlePath)) {
    console.error(`No article found at ${articlePath}`);
    process.exitCode = 1;
    return;
  }
  const { data: article } = readFrontmatter(readFileSync(articlePath, 'utf8'));
  if (article.status !== 'published') {
    console.error(`Article status is "${article.status}", not "published". Publish it first.`);
    process.exitCode = 1;
    return;
  }

  mkdirSync(DRAFTS_DIR, { recursive: true });
  const draftPath = `${DRAFTS_DIR}/${args.slug}.json`;
  const link = `${SITE_URL}/articles/${args.slug}/`;

  if (args.send) {
    if (!existsSync(draftPath)) {
      console.error(`No draft at ${draftPath} yet. Run without --send first to generate one.`);
      process.exitCode = 1;
      return;
    }
    const draft = JSON.parse(readFileSync(draftPath, 'utf8'));
    if (!draft.approved) {
      console.error(`Draft at ${draftPath} is not approved. Review the subject/teaser, set "approved": true, then re-run with --send.`);
      process.exitCode = 1;
      return;
    }
    if (draft.sentAt) {
      console.error(`Draft was already sent at ${draft.sentAt}. Delete that field (or the whole file) to re-send.`);
      process.exitCode = 1;
      return;
    }

    const from = process.env.RESEND_FROM_EMAIL;
    if (!from) throw new Error('Missing required env var: RESEND_FROM_EMAIL (e.g. "Mindtivate Insights <insights@mindtivate.com>")');

    console.log(`Sending broadcast: "${draft.subject}"...`);
    const result = await createBroadcast({
      from,
      subject: draft.subject,
      html: draft.html,
      text: draft.text,
      name: `New article: ${args.slug}`,
      send: true,
    });
    draft.sentAt = new Date().toISOString();
    draft.broadcastId = result.id;
    writeFileSync(draftPath, JSON.stringify(draft, null, 2));
    console.log('Sent.', result.id ?? '');
    return;
  }

  console.log('Drafting subject + teaser with Claude...');
  const { subject, teaser } = await askClaudeForJson({
    system: SYSTEM_PROMPT,
    prompt: `Article title: "${article.title}"\nArticle description: ${article.description}\nCategory: ${article.category}\nArticle link: ${link}\n\nWrite the subject and teaser.`,
    maxTokens: 400,
  });

  const html = renderHtml({ title: article.title, teaser, link });
  const text = renderText({ title: article.title, teaser, link });

  const draft = {
    slug: args.slug,
    articleTitle: article.title,
    articleLink: link,
    subject,
    teaser,
    html,
    text,
    approved: false,
    generatedAt: new Date().toISOString(),
  };
  writeFileSync(draftPath, JSON.stringify(draft, null, 2));
  console.log(`\nDraft written to ${draftPath}`);
  console.log(`Subject: ${subject}`);
  console.log(`Teaser: ${teaser}`);
  console.log('\nReview it, edit the subject/teaser/html fields if needed, set "approved": true,');
  console.log('then re-run this command with --send.');
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

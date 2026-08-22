#!/usr/bin/env node
// Stage 8: weekly digest of newly-published articles, drafted (never sent)
// as a Resend Broadcast.
//
// Unlike stage 7 (one broadcast per article, drafted to a local JSON file
// for approval), this one needs no LLM step — it's just a templated list
// of whatever published in the last 7 days — so the "review before it
// goes out" step happens directly in Resend's own dashboard instead of a
// local file: this script creates the broadcast with send:false, and a
// human opens Resend (Broadcasts tab), edits it if they want, and hits
// Send themselves.
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
//   npm run pipeline:digest -- --dry-run # print what would be drafted, call nothing

import { readdirSync, readFileSync } from 'node:fs';
import { loadEnv } from '../lib/env.mjs';
import { parseFlatYaml, readFrontmatter } from '../lib/frontmatter.mjs';
import { createBroadcast } from '../lib/resend.mjs';

loadEnv();

const ARTICLES_DIR = 'src/content/articles';
const SETTINGS_PATH = 'src/content/settings/site.yml';
const SITE_URL = 'https://mindtivate.com';
const WINDOW_DAYS = 7;

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

function renderHtml(articles) {
  const cards = articles
    .map(({ title, description, category, slug }) => {
      const link = `${SITE_URL}/articles/${slug}/`;
      return `<tr>
        <td style="padding:0 0 1.6em;">
          <p style="margin:0 0 0.3em;font-size:12px;letter-spacing:0.04em;text-transform:uppercase;color:#5f7457;font-family:Arial,sans-serif;">${category}</p>
          <h2 style="margin:0 0 0.4em;font-size:19px;line-height:1.35;color:#2f2a33;"><a href="${link}" style="color:#2f2a33;text-decoration:none;">${title}</a></h2>
          <p style="margin:0 0 0.5em;font-size:15px;line-height:1.6;color:#55505c;">${description}</p>
          <a href="${link}" style="font-size:14px;font-family:Arial,sans-serif;font-weight:bold;color:#d97a5f;text-decoration:none;">Read it →</a>
        </td>
      </tr>`;
    })
    .join('\n');

  return `<!doctype html>
<html>
  <body style="margin:0;padding:32px 24px;background:#fbf6ef;font-family:Georgia,serif;">
    <div style="max-width:560px;margin:0 auto;">
      <p style="margin:0 0 1.5em;font-size:13px;letter-spacing:0.04em;text-transform:uppercase;color:#5f7457;font-family:Arial,sans-serif;">Mindtivate Insights — this week</p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        ${cards}
      </table>
    </div>
  </body>
</html>`;
}

function renderText(articles) {
  return articles
    .map(({ title, description, slug }) => `${title}\n${description}\n${SITE_URL}/articles/${slug}/`)
    .join('\n\n');
}

function buildSubject(articles) {
  if (articles.length === 1) return `New this week: ${articles[0].title}`;
  return `${articles.length} new articles this week on Mindtivate`;
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

  const subject = buildSubject(articles);
  const html = renderHtml(articles);
  const text = renderText(articles);

  console.log(`Digest: "${subject}"`);
  for (const a of articles) console.log(`  - [${a.category}] ${a.title}`);

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

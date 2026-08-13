#!/usr/bin/env node
// Stage 6: draft a Reddit comment that references a published Mindtivate
// article, for the thread the article was originally researched from.
//
// This script NEVER posts on its first run. It writes a draft to
// scripts/pipeline/output/reddit-comment-drafts/<slug>.json with
// "approved": false. A human must open that file, edit the comment text if
// needed, and change it to "approved": true before `--post` will do
// anything. This exists because most of the target subreddits
// (r/loseit, r/xxfitness, r/bodyweightfitness, r/nutrition, r/mentalhealth)
// have explicit rules against self-promotion and link-dropping — see
// docs/COMPLIANCE.md. Auto-posting without a human checking the specific
// thread's current rules and context is how accounts get banned and how
// the site gets a spam reputation.
//
// Usage:
//   npm run pipeline:engage -- --slug some-article-slug          # draft only
//   npm run pipeline:engage -- --slug some-article-slug --post    # post, only if approved

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { loadEnv } from '../lib/env.mjs';
import { askClaude } from '../lib/claude.mjs';
import { readFrontmatter } from '../lib/frontmatter.mjs';
import { getRedditToken, fetchThreadInfo, postComment } from '../lib/reddit.mjs';

loadEnv();

const DRAFTS_DIR = 'scripts/pipeline/output/reddit-comment-drafts';

const SYSTEM_PROMPT = `You write a single Reddit comment in the voice of someone who genuinely
researched an answer to the thread's question, not a marketer. Rules:
- Answer the question directly first, in your own words.
- Mention that you wrote up the full research as an article, and include
  the link once, naturally, near the end — never as the whole comment.
- No emoji, no hype, no "check out my site!" energy.
- 80-150 words.
- Do not claim personal experience you don't have; speak as "we researched" (Mindtivate is a team, not one person).
Output plain text only — the comment body, nothing else.`;

function parseArgs(argv) {
  const args = { post: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--slug') args.slug = argv[++i];
    else if (argv[i] === '--post') args.post = true;
  }
  return args;
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.slug) {
    console.error('Usage: npm run pipeline:engage -- --slug <article-slug> [--post]');
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
  if (!article.sourceThreadUrl) {
    console.error('Article has no sourceThreadUrl — nothing to comment on.');
    process.exitCode = 1;
    return;
  }

  mkdirSync(DRAFTS_DIR, { recursive: true });
  const draftPath = `${DRAFTS_DIR}/${args.slug}.json`;

  if (args.post) {
    if (!existsSync(draftPath)) {
      console.error(`No draft at ${draftPath} yet. Run without --post first to generate one.`);
      process.exitCode = 1;
      return;
    }
    const draft = JSON.parse(readFileSync(draftPath, 'utf8'));
    if (!draft.approved) {
      console.error(`Draft at ${draftPath} is not approved. Review the comment text, set "approved": true, then re-run with --post.`);
      process.exitCode = 1;
      return;
    }

    const token = await getRedditToken();
    const thread = await fetchThreadInfo(token, article.sourceThreadUrl);
    console.log(`Posting comment to: ${thread.title}`);
    const result = await postComment(token, { parentFullname: thread.fullname, text: draft.commentMarkdown });
    console.log('Posted.', result.json?.data?.things?.[0]?.data?.permalink ?? '');
    return;
  }

  const link = `https://mindtivate.com/articles/${args.slug}/`;
  const prompt = `Original thread: ${article.sourceThreadUrl}\nArticle title: "${article.title}"\nArticle summary: ${article.description}\nArticle link: ${link}\n\nWrite the comment.`;
  console.log('Drafting comment with Claude...');
  const commentMarkdown = (await askClaude({ system: SYSTEM_PROMPT, prompt, maxTokens: 400 })).trim();

  const draft = {
    slug: args.slug,
    threadUrl: article.sourceThreadUrl,
    subreddit: article.sourceSubreddit,
    articleLink: link,
    commentMarkdown,
    approved: false,
    generatedAt: new Date().toISOString(),
  };
  writeFileSync(draftPath, JSON.stringify(draft, null, 2));
  console.log(`\nDraft written to ${draftPath}`);
  console.log('Review it, check the subreddit\'s current self-promotion rules, edit the text if');
  console.log('needed, set "approved": true, then re-run this command with --post.');
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

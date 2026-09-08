#!/usr/bin/env node
// Stage 6: draft a Reddit comment that references a published Mindtivate
// article, for the thread the article was originally researched from.
//
// This script NEVER posts on its first run. It writes a draft to
// scripts/pipeline/reddit-comment-drafts/<slug>.json with "approved":
// false. A human must review it and change that to "approved": true
// before `--post` will do anything. This exists because most of the
// target subreddits (r/loseit, r/xxfitness, r/bodyweightfitness,
// r/nutrition, r/mentalhealth) have explicit rules against
// self-promotion and link-dropping — see docs/COMPLIANCE.md.
// Auto-posting without a human checking the specific thread's current
// rules and context is how accounts get banned and how the site gets a
// spam reputation.
//
// Unlike the old version of this script, the drafts directory is
// deliberately NOT gitignored: weekly-reddit-comment-drafts.yml runs the
// drafting half on a schedule and opens a PR with the results, so
// reviewing means reading the comment text right in the PR (much lighter
// than Pinterest's image review — it's 80-150 words) and flipping one
// field before merging. --send still only ever runs locally, by a
// human, same as every other "goes out publicly" step in this pipeline.
//
// Usage:
//   npm run pipeline:engage -- --slug some-article-slug          # draft only
//   npm run pipeline:engage -- --slug some-article-slug --post    # post, only if approved

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { loadEnv } from '../lib/env.mjs';
import { askPoe } from '../lib/poe.mjs';
import { readFrontmatter, insertFrontmatterField } from '../lib/frontmatter.mjs';
import { getRedditToken, fetchThreadInfo, postComment } from '../lib/reddit.mjs';

loadEnv();

const DRAFTS_DIR = 'scripts/pipeline/reddit-comment-drafts';

const SYSTEM_PROMPT = `You write a single Reddit comment in the voice of someone who genuinely
researched an answer to the thread's question, not a marketer. Rules:
- Answer the question directly first, in your own words.
- Mention that you wrote up the full research as an article, and include
  the link once, naturally, near the end — never as the whole comment.
- No emoji, no hype, no "check out my site!" energy.
- 80-150 words.
- Do not claim personal experience you don't have; speak as "we researched" (Mindtivate is a team, not one person).
- The ONLY link anywhere in the comment is that one article link. Do not
  add a "Learn more" / "Sources" / citations section, a numbered link
  list, or any other link — even a citation-style one. A pile of extra
  links (especially to unrelated sites or a competitor) is exactly the
  kind of thing that gets a comment removed as spam, regardless of how
  well-researched the writing itself is.
- CRITICAL: Do not narrate what you're about to do or think out loud
  before the comment. Never start with "Let me...", "Based on the
  search results...", "Based on the article...", "I'll write...",
  "Here's the comment:", or anything else describing your own process —
  a human reading this on Reddit only ever sees the comment text itself,
  never your reasoning about how you produced it. Output must begin
  directly with the comment's actual first word.
Output plain text only — the comment body, nothing else. No headings, no
list of links or sources at the end, no markdown besides the one inline
link to the article, and no preamble of any kind before it.`;

// Defense in depth on top of the prompt above — a search-capable or
// reasoning-heavy Poe bot doesn't reliably follow "no preamble, no
// sources list" instructions (confirmed against real drafts: several
// came back with leaked meta-commentary like "Let me look at the actual
// thread..." glued onto the front, and/or a numbered "Learn more:"
// citation dump at the end despite the prompt explicitly forbidding
// both). This strips both patterns after the fact so a slip in one
// generation doesn't require a human to catch and hand-edit it.
function sanitizeCommentDraft(raw) {
  let text = raw.trim();

  // Trailing "Learn more:" / "Sources:" / "References:" section, with or
  // without a "---" divider before it, through to the end of the string.
  text = text.replace(/\n+-{2,}\s*\n+(?:learn more|sources?|references?)\s*:[\s\S]*$/i, '');
  text = text.replace(/\n+(?:learn more|sources?|references?)\s*:[\s\S]*$/i, '');

  // Leading meta-commentary paragraph -- narrating the task itself
  // ("Let me...", "Based on the article/thread/search...", "I'll
  // write...", "Here's the comment:") rather than being the comment.
  // Only strips the first paragraph, and only when it both matches one
  // of these openers AND there's a real paragraph after it to fall back
  // to -- never risk leaving an empty comment.
  const firstBreak = text.indexOf('\n\n');
  const firstParagraph = firstBreak === -1 ? text : text.slice(0, firstBreak);
  const looksLikeMetaCommentary =
    /^(let me|based on the (article|thread|search)|i'll write|i will write|here'?s the comment)/i.test(firstParagraph.trim());
  if (looksLikeMetaCommentary && firstBreak !== -1) {
    text = text.slice(firstBreak + 2).trim();
  }

  return text.trim();
}

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
    if (draft.sentAt) {
      console.error(`Draft was already posted at ${draft.sentAt} (${draft.commentUrl}). Delete that field (or the whole file) to re-post.`);
      process.exitCode = 1;
      return;
    }

    const token = await getRedditToken();
    const thread = await fetchThreadInfo(token, article.sourceThreadUrl);
    console.log(`Posting comment to: ${thread.title}`);
    const result = await postComment(token, { parentFullname: thread.fullname, text: draft.commentMarkdown });
    const permalink = result.json?.data?.things?.[0]?.data?.permalink;
    const commentUrl = permalink ? `https://www.reddit.com${permalink}` : null;

    draft.sentAt = new Date().toISOString();
    draft.commentUrl = commentUrl;
    writeFileSync(draftPath, JSON.stringify(draft, null, 2));

    if (commentUrl) {
      const updatedArticle = insertFrontmatterField(readFileSync(articlePath, 'utf8'), 'redditCommentUrl', commentUrl);
      writeFileSync(articlePath, updatedArticle);
      console.log(`Posted: ${commentUrl}`);
      console.log(`Recorded redditCommentUrl in ${articlePath}.`);
    } else {
      console.log('Posted, but no permalink came back in the response — record the URL in Pages CMS by hand.');
    }
    return;
  }

  const link = `https://mindtivate.com/articles/${args.slug}/`;
  const prompt = `Original thread: ${article.sourceThreadUrl}\nArticle title: "${article.title}"\nArticle summary: ${article.description}\nArticle link: ${link}\n\nWrite the comment.`;
  console.log('Drafting comment with Poe...');
  const rawComment = await askPoe({ system: SYSTEM_PROMPT, prompt, maxTokens: 400 });
  const commentMarkdown = sanitizeCommentDraft(rawComment);

  const urlCount = (commentMarkdown.match(/https?:\/\/\S+/g) ?? []).length;
  if (urlCount > 1) {
    console.warn(
      `  WARNING: drafted comment has ${urlCount} links (expected exactly 1 -- the article link). Review closely before approving.`,
    );
  } else if (urlCount === 0) {
    console.warn('  WARNING: drafted comment has no link at all -- the article link may have been dropped. Review before approving.');
  }

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

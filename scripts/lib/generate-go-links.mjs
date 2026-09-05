#!/usr/bin/env node
// Regenerates worker/go-links.generated.json -- a { slug: destinationUrl }
// map the Worker (worker/index.ts) uses to resolve /go/<slug> redirects.
// Cloaking every affiliate link behind a stable Mindtivate URL (rather
// than linking straight to the raw affiliate URL from ProductCallout.astro)
// means a rotated/expired tracking link only ever needs updating in one
// place -- the product record -- and never breaks a link someone already
// shared or bookmarked.
//
// Runs automatically before every `npm run build` (see package.json's
// "prebuild" script) -- including Cloudflare's own deploy build, which is
// the only documented build entrypoint for this repo (docs/SETUP.md). So
// this always reflects the current src/content/products/*.md, however
// that got created or edited (pipeline or Pages CMS), with no separate
// sync step to remember. Deliberately NOT run from the content pipeline
// scripts themselves for that reason -- one source of truth, not two.

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { readFrontmatter } from './frontmatter.mjs';

const PRODUCTS_DIR = 'src/content/products';
const OUT_PATH = 'worker/go-links.generated.json';

function run() {
  const files = readdirSync(PRODUCTS_DIR).filter((f) => f.endsWith('.md'));

  const links = {};
  for (const file of files) {
    const slug = file.replace(/\.md$/, '');
    const { data } = readFrontmatter(readFileSync(`${PRODUCTS_DIR}/${file}`, 'utf8'));
    const isLive = ['approved', 'active'].includes(data.affiliateStatus) && data.affiliateUrl;
    if (isLive) links[slug] = data.affiliateUrl;
  }

  writeFileSync(OUT_PATH, JSON.stringify(links, null, 2) + '\n');
  console.log(`Wrote ${Object.keys(links).length} go-link(s) to ${OUT_PATH}`);
}

run();

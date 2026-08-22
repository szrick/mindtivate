// Renders a Pinterest pin image: the article's own hero photo, a gradient
// scrim for legibility, a category badge, headline/subtext, and the
// Mindtivate wordmark — at Pinterest's recommended 1000x1500 (2:3).
//
// Uses a real headless browser (Playwright) rather than a hand-built SVG
// renderer: it gives exact CSS control (the same gradient/typography
// system the rest of the site already uses) and free text wrapping,
// which a hand-rolled SVG <text> layout would have to reimplement badly.
// The tradeoff is a Chromium download in CI — acceptable for a
// once-a-week drafting run, not a hot path.

import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

const BRAND = {
  terracotta: '#d97a5f',
  plum: '#2f2a33',
  cream: '#f2e9db',
};

function buildHtml({ heroImageDataUri, logoDataUri, category, headline, subtext }) {
  return `<!doctype html>
<html><head><meta charset="utf-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    width: 1000px;
    height: 1500px;
    position: relative;
    font-family: Georgia, serif;
    background: ${BRAND.plum};
    overflow: hidden;
  }
  .bg {
    position: absolute;
    inset: 0;
    width: 1000px;
    height: 1500px;
    object-fit: cover;
  }
  .scrim {
    position: absolute;
    inset: 0;
    background: linear-gradient(180deg, rgba(47,42,51,0.05) 0%, rgba(47,42,51,0.15) 40%, rgba(47,42,51,0.92) 78%, rgba(47,42,51,0.97) 100%);
  }
  .badge {
    position: absolute;
    top: 64px;
    left: 64px;
    background: ${BRAND.terracotta};
    color: #ffffff;
    font-family: Arial, sans-serif;
    font-weight: 700;
    font-size: 24px;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    padding: 14px 28px;
    border-radius: 999px;
  }
  .content {
    position: absolute;
    left: 64px;
    right: 64px;
    bottom: 96px;
  }
  .title {
    font-family: Georgia, serif;
    font-weight: 700;
    font-size: 64px;
    line-height: 1.18;
    color: #ffffff;
    margin-bottom: 36px;
  }
  .sub {
    font-family: Arial, sans-serif;
    font-size: 28px;
    line-height: 1.5;
    color: ${BRAND.cream};
    margin-bottom: 56px;
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 16px;
  }
  .brand img {
    width: 48px;
    height: 48px;
  }
  .brand span {
    font-family: Georgia, serif;
    font-weight: 700;
    font-size: 30px;
    color: #ffffff;
  }
  .brand .dot {
    color: ${BRAND.terracotta};
  }
</style>
</head>
<body>
  <img class="bg" src="${heroImageDataUri}" />
  <div class="scrim"></div>
  <div class="badge">${category}</div>
  <div class="content">
    <div class="title">${headline}</div>
    <div class="sub">${subtext}</div>
    <div class="brand">
      <img src="${logoDataUri}" />
      <span>Mindtivate<span class="dot">.</span></span>
    </div>
  </div>
</body></html>`;
}

function toDataUri(filePath) {
  const ext = filePath.split('.').pop().toLowerCase();
  const mime = ext === 'png' ? 'image/png' : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : 'image/svg+xml';
  return `data:${mime};base64,${readFileSync(filePath).toString('base64')}`;
}

/**
 * Renders the pin image and returns a PNG Buffer.
 * @param {{ heroImagePath: string, category: string, headline: string, subtext: string, logoPath?: string }} opts
 */
export async function renderPinImage({ heroImagePath, category, headline, subtext, logoPath = 'public/logo-icon.png' }) {
  const html = buildHtml({
    heroImageDataUri: toDataUri(heroImagePath),
    logoDataUri: toDataUri(logoPath),
    category,
    headline,
    subtext,
  });

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1000, height: 1500 } });
    await page.setContent(html);
    return await page.screenshot({ type: 'png' });
  } finally {
    await browser.close();
  }
}

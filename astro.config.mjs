import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// Serving from the mindtivate.com custom domain root — see public/CNAME.
// (Previously this targeted the default GitHub Pages project URL,
// https://szrick.github.io/mindtivate/, which needed base: '/mindtivate/'.
// If the custom domain is ever removed, revert to that — see git history.)
export default defineConfig({
  site: 'https://mindtivate.com',
  base: '/',
  integrations: [
    sitemap({
      // /search and /saved carry <meta name="robots" content="noindex"> --
      // they're client-JS-only utility pages with no meaningful static
      // content Google can evaluate (see Seo.astro's `noindex` prop and
      // where it's set). Listing a noindexed URL in the sitemap sends
      // Google a mixed signal ("index me" via the sitemap vs. "don't" via
      // the meta tag) and was very likely why one of them got flagged as
      // a Soft 404 in Search Console in the first place.
      //
      // The /newsletter/* pages are the same class of problem: they're
      // interstitial confirm/error/thank-you pages only ever reached after
      // a form submit or an email link click, not content anyone should
      // land on from search -- also given `noindex` (see each page's
      // <BaseLayout noindex> prop) and excluded here for the same reason.
      filter: (page) =>
        !['/search/', '/saved/'].some((path) => page.endsWith(path)) && !page.includes('/newsletter/'),
    }),
  ],
  // Inlines every page's stylesheet directly into its HTML instead of a
  // separate render-blocking <link rel="stylesheet"> request -- PageSpeed
  // Insights flagged this on mobile ("Render-blocking requests", "Network
  // dependency tree"). 'auto' (Vite's default 4 KiB inline threshold) isn't
  // enough here: Vite's CSS code-splitting bundles this site down to just
  // two shared chunks (~8 KiB and ~10 KiB raw -- every non-article page
  // loads the ~10 KiB one, including ArticleLayout's styles it never uses),
  // both over that threshold. Since almost all real traffic lands here as a
  // first-time visit from search/Pinterest (not a return visit that would
  // benefit from the external file's cross-page HTTP cache), avoiding the
  // extra request on that critical first render outweighs losing that
  // caching. See git history if per-page CSS splitting ever gets addressed
  // properly -- inlining the same ~10 KiB across every page isn't free.
  build: {
    inlineStylesheets: 'always',
  },
  output: 'static',
});

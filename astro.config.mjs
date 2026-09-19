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
      filter: (page) => !['/search/', '/saved/'].some((path) => page.endsWith(path)),
    }),
  ],
  output: 'static',
});

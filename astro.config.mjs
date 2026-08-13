import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// `site`/`base` currently target the default GitHub Pages project URL
// (https://szrick.github.io/mindtivate/), which serves from a /mindtivate/
// subpath. Once the mindtivate.com custom domain is configured (see
// docs/SETUP.md — it serves from the domain root), switch to:
//   site: 'https://mindtivate.com', base: '/'
// and add a public/CNAME file containing "mindtivate.com". Also update the
// Sitemap line in public/robots.txt to match.
export default defineConfig({
  site: 'https://szrick.github.io',
  base: '/mindtivate/',
  integrations: [sitemap()],
  output: 'static',
});

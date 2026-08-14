import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// Serving from the mindtivate.com custom domain root — see public/CNAME.
// (Previously this targeted the default GitHub Pages project URL,
// https://szrick.github.io/mindtivate/, which needed base: '/mindtivate/'.
// If the custom domain is ever removed, revert to that — see git history.)
export default defineConfig({
  site: 'https://mindtivate.com',
  base: '/',
  integrations: [sitemap()],
  output: 'static',
});

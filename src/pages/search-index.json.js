import { getCollection } from 'astro:content';

// Lightweight build-time search index, fetched client-side by /search.
// This is a static site with no server, so keyword search happens
// entirely in the browser against this JSON — fine at the site's current
// scale, but worth revisiting (e.g. Pagefind) if the article count grows
// large enough that shipping the whole index becomes wasteful.
export async function GET() {
  const articles = await getCollection('articles', ({ data }) => data.status === 'published' && !data.draft);

  const index = articles.map((article) => {
    const { title, description, category, tags } = article.data;
    const searchText = [title, description, category, ...(tags ?? [])].join(' ').toLowerCase();
    return { slug: article.slug, title, description, category, searchText };
  });

  return new Response(JSON.stringify(index), {
    headers: { 'Content-Type': 'application/json' },
  });
}

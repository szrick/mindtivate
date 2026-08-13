import rss from '@astrojs/rss';
import { getCollection } from 'astro:content';

// Sender.net's RSS-to-email automation can watch this feed and send
// subscribers a "new post" email automatically, with no manual campaign
// work per article. See docs/CONTENT_PIPELINE.md.
export async function GET(context) {
  const articles = await getCollection('articles', ({ data }) => data.status === 'published' && !data.draft);
  const sorted = articles.sort((a, b) => b.data.pubDate.valueOf() - a.data.pubDate.valueOf());

  return rss({
    title: 'Mindtivate',
    description: 'Fitness, nutrition, and mental-health guidance for women.',
    site: context.site,
    items: sorted.map((article) => ({
      title: article.data.title,
      description: article.data.description,
      pubDate: article.data.pubDate,
      link: `/articles/${article.slug}/`,
      categories: [article.data.category, ...article.data.tags],
    })),
  });
}

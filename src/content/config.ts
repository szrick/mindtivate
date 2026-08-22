import { defineCollection, reference, z } from 'astro:content';

const articles = defineCollection({
  type: 'content',
  schema: ({ image }) =>
    z.object({
      title: z.string(),
      description: z.string(),
      pubDate: z.coerce.date(),
      updatedDate: z.coerce.date().optional(),
      category: z.enum(['Body', 'Food', 'Mind', 'Hormones', 'Love', 'Beauty', 'Sleep', 'Life Stages']),
      heroImage: image().optional(),
      heroImageAlt: z.string().optional(),
      status: z.enum(['draft', 'in-review', 'published']).default('draft'),
      draft: z.boolean().default(true),
      author: reference('authors').optional(),
      sourceSubreddit: z.string().optional(),
      sourceThreadUrl: z.string().url().optional(),
      featuredProducts: z.array(reference('products')).default([]),
      pinterestPinUrl: z.string().url().optional(),
      redditCommentUrl: z.string().url().optional(),
      tags: z.array(z.string()).default([]),
    }),
});

const products = defineCollection({
  type: 'content',
  schema: ({ image }) =>
    z.object({
      name: z.string(),
      category: z.enum(['Equipment', 'Apparel', 'Supplement', 'App / Program', 'Book', 'Wearable']),
      image: image().optional(),
      shortPitch: z.string(),
      affiliateProgram: z.string().optional(),
      affiliateStatus: z
        .enum(['not-applied', 'applied', 'approved', 'rejected', 'active'])
        .default('not-applied'),
      affiliateUrl: z.string().url().optional(),
      disclosureRequired: z.boolean().default(true),
      problemSolved: z.string().optional(),
    }),
});

const authors = defineCollection({
  type: 'content',
  schema: ({ image }) =>
    z.object({
      name: z.string(),
      role: z.string().optional(),
      bio: z.string().optional(),
      avatar: image().optional(),
    }),
});

export const collections = { articles, products, authors };

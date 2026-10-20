import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

const guides = defineCollection({
  loader: glob({ pattern: '*.md', base: './src/content/guides' }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    device: z.string(),
    date: z.coerce.date(),
    steps: z.array(z.object({ name: z.string(), text: z.string() })),
  }),
});

export const collections = { guides };

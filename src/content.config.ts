/**
 * Content Layer config — Astro v6
 *
 * Uses the new glob() loader instead of the removed legacy
 * `type: 'content'` API. The loader finds every *.md file
 * inside src/content/work/ and maps it to a typed entry.
 *
 * Entry IDs are derived from the filename (without extension),
 * e.g. "meridian-brand-identity" from meridian-brand-identity.md
 */
import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const work = defineCollection({
  loader: glob({
    pattern: '**/*.md',
    base: './src/content/work',
  }),

  schema: ({ image }) =>
    z.object({
      /** Display title of the project */
      title: z.string(),

      /** Discipline / medium tags shown on the card */
      tags: z.array(z.string()),

      /** Four-digit completion year */
      year: z.number().int().min(2000).max(2100),

      /** Short project description (1–3 sentences) */
      description: z.string(),

      /** Primary thumbnail shown in the grid */
      thumbnail: image(),

      /** Optional second image revealed on card hover */
      hoverImage: image().optional(),

      /** Flag for promoting to a featured / hero slot */
      featured: z.boolean().default(false),

      /** Optional external link for the project (live site, video, etc.) */
      externalUrl: z.string().url().optional(),

      /** Behind-the-scenes: the creative intention */
      intention: z.string().optional(),

      /** Behind-the-scenes: key creative decisions */
      decisions: z.array(z.object({
        label: z.string(),
        body: z.string(),
      })).optional(),

      /** Behind-the-scenes: process / WIP images */
      processImages: z.array(image()).optional(),

      /** Closing thread / series note shown as a pull quote */
      thread: z.string().optional(),
    }),
});

export const collections = { work };

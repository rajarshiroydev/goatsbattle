import type { APIRoute } from 'astro';
import { z } from 'zod';
import { getBattleSummaries } from '../../lib/queries';
import { slugSchema } from '../../lib/apiValidation';

export const prerender = false;

/** Matches the carousel's deck size — the homepage never asks for more. */
const battlesSchema = z.array(slugSchema).min(1).max(8);

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      // Short edge cache: homepage tallies drift far slower than page views,
      // and every anonymous visitor asks for the same handful of battles.
      'Cache-Control': 'public, max-age=15, s-maxage=30',
    },
  });

/**
 * Live tallies for the homepage marquee carousel. The page itself is a static
 * zero-tally shell, so this is the only database work an anonymous homepage
 * visit can trigger — and only after the island mounts.
 */
export const GET: APIRoute = async ({ url }) => {
  const parsed = battlesSchema.safeParse(url.searchParams.getAll('battle'));
  if (!parsed.success) return json({ error: 'one to eight valid battle params required' }, 400);

  // Non-critical decoration: a transient neon-http hiccup must leave the
  // already-rendered static deck standing rather than 500 the fetch.
  try {
    const summaries = await getBattleSummaries(parsed.data);
    return json(summaries.map((s) => ({
      slug: s.slug,
      leftPct: s.pctA,
      total: s.total,
    })));
  } catch (err) {
    console.error('home-battles query failed:', err);
    return json([]);
  }
};

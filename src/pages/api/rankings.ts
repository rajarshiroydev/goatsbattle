import type { APIRoute } from 'astro';
import { getRankings } from '../../lib/queries';
import { toRankEntry } from '../../lib/rankWire';

export const prerender = false;

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      // Short edge cache: rankings shift slowly relative to page views.
      'Cache-Control': 'public, max-age=15, s-maxage=30',
    },
  });

export const GET: APIRoute = async ({ url }) => {
  const arena = url.searchParams.get('arena') ?? 'football';
  const rankings = await getRankings(arena);
  if (rankings.length === 0) return json({ error: 'Unknown arena' }, 404);
  return json(rankings.map(toRankEntry));
};

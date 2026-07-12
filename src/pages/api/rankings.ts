import type { APIRoute } from 'astro';
import { getRankings } from '../../lib/queries';
import { toRankEntry } from '../../lib/rankWire';
import { rateLimit } from '../../lib/ratelimit';
import { getClientIp, hashIp } from '../../lib/ip';
import { arenaSchema } from '../../lib/apiValidation';

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

export const GET: APIRoute = async ({ url, request }) => {
  const parsedArena = arenaSchema.safeParse(url.searchParams.get('arena') ?? 'football');
  if (!parsedArena.success) return json({ error: 'Unknown arena' }, 404);
  const arena = parsedArena.data;
  const rl = await rateLimit(`rankings:${hashIp(getClientIp(request.headers))}`, { max: 60 });
  if (!rl.ok) return json({ error: 'Too many requests' }, 429);
  const rankings = await getRankings(arena);
  if (rankings.length === 0) return json({ error: 'Unknown arena' }, 404);
  return json(rankings.map(toRankEntry));
};

import type { APIRoute } from 'astro';
import { getHeadToHeadRecordForEntity } from '../../lib/queries';
import { toContestedBattle } from '../../lib/battleWire';
import { rateLimit } from '../../lib/ratelimit';
import { getClientIp, hashIp } from '../../lib/ip';
import { slugSchema } from '../../lib/apiValidation';

export const prerender = false;

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      // Short edge cache: a goat's contested battles shift slowly vs. page views.
      'Cache-Control': 'public, max-age=15, s-maxage=30',
    },
  });

export const GET: APIRoute = async ({ url, request }) => {
  const parsedGoat = slugSchema.safeParse(url.searchParams.get('goat'));
  if (!parsedGoat.success) return json({ error: 'valid goat query param required' }, 400);
  const goat = parsedGoat.data;
  const rl = await rateLimit(`goat-battles:${hashIp(getClientIp(request.headers))}`, { max: 60 });
  if (!rl.ok) return json({ error: 'Too many requests' }, 429);

  // The head-to-head record is non-critical: a transient neon-http hiccup
  // shouldn't 500 (and pop the dev error overlay). Degrade to an empty list.
  try {
    const battles = await getHeadToHeadRecordForEntity(goat);
    return json(battles.map((b) => toContestedBattle(b, goat)));
  } catch (err) {
    console.error('goat-battles query failed:', err);
    return json([]);
  }
};

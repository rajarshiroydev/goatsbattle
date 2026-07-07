import type { APIRoute } from 'astro';
import { getContestedBattlesForEntity } from '../../lib/queries';
import { toContestedBattle } from '../../lib/battleWire';

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

export const GET: APIRoute = async ({ url }) => {
  const goat = url.searchParams.get('goat');
  if (!goat) return json({ error: 'goat query param required' }, 400);

  const battles = await getContestedBattlesForEntity(goat, 6);
  return json(battles.map((b) => toContestedBattle(b, goat)));
};

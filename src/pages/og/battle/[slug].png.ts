import type { APIRoute } from 'astro';
import { allBattlePairs, getEntityBySlug } from '../../../data';
import { getBattleId, parseBattleSlug } from '../../../lib/battle';
import { renderBattleOg } from '../../../lib/og';

// One PNG per canonical battle, generated at build time.
export function getStaticPaths() {
  return allBattlePairs.map(([a, b]) => ({ params: { slug: getBattleId(a, b) } }));
}

export const GET: APIRoute = async ({ params }) => {
  const parsed = parseBattleSlug(params.slug ?? '');
  if (!parsed) return new Response('Not found', { status: 404 });

  const a = getEntityBySlug(parsed[0]);
  const b = getEntityBySlug(parsed[1]);
  if (!a || !b) return new Response('Not found', { status: 404 });

  const png = await renderBattleOg(a, b);
  return new Response(new Uint8Array(png), {
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
};

import type { APIRoute } from 'astro';
import { getLockedEntities } from '../../lib/voteService';
import { getClientIp, hashIp } from '../../lib/ip';

export const prerender = false;

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

/**
 * GET ?arena=football → entity ids this fingerprint has crowned within the
 * live window. Champion Mode uses this to drop recently-crowned GOATs from a
 * ranked run's pool.
 */
export const GET: APIRoute = async ({ url, request }) => {
  const arena = url.searchParams.get('arena');
  if (!arena) return json({ error: 'arena is required' }, 400);
  const ipHash = hashIp(getClientIp(request.headers));
  const locked = await getLockedEntities(arena, ipHash);
  return json({ locked });
};

import type { APIRoute } from 'astro';
import { getLockedEntities } from '../../lib/voteService';

export const prerender = false;

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

/**
 * GET ?arena=football → entity ids this user has crowned within the live window.
 * Champion Mode uses this to drop recently-crowned GOATs from a ranked run's
 * pool. Empty for logged-out users.
 */
export const GET: APIRoute = async ({ url, locals }) => {
  const arena = url.searchParams.get('arena');
  if (!arena) return json({ error: 'arena is required' }, 400);
  const locked = await getLockedEntities(arena, locals.user?.id ?? null);
  return json({ locked });
};

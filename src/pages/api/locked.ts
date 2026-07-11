import type { APIRoute } from 'astro';
import { getLockedEntities } from '../../lib/voteService';
import { arenaSchema } from '../../lib/apiValidation';
import { rateLimit } from '../../lib/ratelimit';

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
  const parsedArena = arenaSchema.safeParse(url.searchParams.get('arena'));
  if (!parsedArena.success) return json({ error: 'valid arena is required' }, 400);
  const arena = parsedArena.data;
  if (locals.user) {
    const rl = await rateLimit(`locked:${locals.user.id}`, { max: 60 });
    if (!rl.ok) return json({ error: 'Too many requests' }, 429);
  }
  const locked = await getLockedEntities(arena, locals.user?.id ?? null);
  return json({ locked });
};

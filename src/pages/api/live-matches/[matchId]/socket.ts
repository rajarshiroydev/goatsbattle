import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { eq } from 'drizzle-orm';
import { slugSchema } from '../../../../lib/apiValidation';
import { db } from '../../../../lib/db';
import { matches } from '../../../../lib/db/schema';
import { getClientIp, hashIp } from '../../../../lib/ip';
import { rateLimit } from '../../../../lib/ratelimit';

export const prerender = false;

export const GET: APIRoute = async ({ params, request }) => {
  const parsed = slugSchema.safeParse(params.matchId);
  if (!parsed.success) return Response.json({ error: 'Valid match id required' }, { status: 400 });
  if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
    return Response.json({ error: 'WebSocket upgrade required' }, { status: 426 });
  }
  const origin = request.headers.get('origin');
  if (!origin || origin !== new URL(request.url).origin) {
    return Response.json({ error: 'Invalid WebSocket origin' }, { status: 403 });
  }
  const limit = await rateLimit(`match-socket:${parsed.data}:${hashIp(getClientIp(request.headers))}`, { max: 30 });
  if (!limit.ok) {
    return Response.json({ error: 'Too many connection attempts' }, {
      status: 429,
      headers: { 'Retry-After': String(limit.retryAfter) },
    });
  }
  const [match] = await db.select({ id: matches.id }).from(matches).where(eq(matches.id, parsed.data)).limit(1);
  if (!match) return Response.json({ error: 'Match not found' }, { status: 404 });
  return env.LIVE_MATCH_COORDINATOR.getByName(match.id).fetch(request);
};

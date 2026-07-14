import type { APIRoute } from 'astro';
import { slugSchema } from '../../lib/apiValidation';
import { getMatchMoments } from '../../lib/queries';
import { getClientIp, hashIp } from '../../lib/ip';
import { rateLimit } from '../../lib/ratelimit';

export const prerender = false;

export const GET: APIRoute = async ({ request, url }) => {
  const parsed = slugSchema.safeParse(url.searchParams.get('match'));
  if (!parsed.success) return Response.json({ error: 'valid match query param required' }, { status: 400 });
  const limit = await rateLimit(`moments:read:${hashIp(getClientIp(request.headers))}`, { max: 120 });
  if (!limit.ok) {
    return Response.json({ error: 'Too many requests.' }, {
      status: 429,
      headers: { 'Retry-After': String(limit.retryAfter), 'Cache-Control': 'private, no-store' },
    });
  }
  const moments = await getMatchMoments(parsed.data);
  return Response.json({ moments }, {
    headers: { 'Cache-Control': 'public, max-age=30, s-maxage=120, stale-while-revalidate=120' },
  });
};

import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { slugSchema } from '../../lib/apiValidation';
import { getMatchMomentFeed } from '../../lib/queries';
import { getClientIp, hashIp } from '../../lib/ip';
import { rateLimit } from '../../lib/ratelimit';

export const prerender = false;

export const GET: APIRoute = async ({ request, url }) => {
  const parsed = slugSchema.safeParse(url.searchParams.get('match'));
  if (!parsed.success) return Response.json({ error: 'valid match query param required' }, { status: 400 });
  // The two timeline islands share one 15-second poll (4/minute). Leave room for
  // reloads while bounding direct API abuse and database amplification.
  const limit = await rateLimit(`moments:read:${hashIp(getClientIp(request.headers))}`, { max: 30 });
  if (!limit.ok) {
    return Response.json({ error: 'Too many requests.' }, {
      status: 429,
      headers: { 'Retry-After': String(limit.retryAfter), 'Cache-Control': 'private, no-store' },
    });
  }
  // Local development has no APP_ENV binding; deployed environments must opt in
  // explicitly so provisional events can be rehearsed on preview before prod.
  const liveEnabled = env.LIVE_MOMENTS_ENABLED === 'true' || env.APP_ENV === undefined;
  const feed = await getMatchMomentFeed(parsed.data, liveEnabled);
  const isChanging = liveEnabled
    && (feed.matchStatus === 'live' || feed.matchStatus === 'scheduled' || feed.hasProvisional);
  return Response.json({ ...feed, liveEnabled }, {
    headers: {
      'Cache-Control': isChanging
        ? 'public, max-age=5, s-maxage=15, stale-while-revalidate=15'
        : 'public, max-age=30, s-maxage=120, stale-while-revalidate=120',
    },
  });
};

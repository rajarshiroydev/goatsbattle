import type { APIRoute } from 'astro';
import { slugSchema } from '../../lib/apiValidation';
import { getMatchMoments } from '../../lib/queries';

export const prerender = false;

export const GET: APIRoute = async ({ url }) => {
  const parsed = slugSchema.safeParse(url.searchParams.get('match'));
  if (!parsed.success) return Response.json({ error: 'valid match query param required' }, { status: 400 });
  const moments = await getMatchMoments(parsed.data);
  return Response.json({ moments }, {
    headers: { 'Cache-Control': 'public, max-age=30, s-maxage=120, stale-while-revalidate=120' },
  });
};

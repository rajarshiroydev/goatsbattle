import type { APIRoute } from 'astro';
import { getFloorEvents } from '../../lib/queries';
import { parseFloorFilter } from '../../lib/floorFilters';

export const prerender = false;

export const GET: APIRoute = async ({ url, locals }) => {
  const filter = parseFloorFilter(url.searchParams.get('filter'));
  // Static pages already cover anonymous top/recent/live reads. Keep this
  // endpoint focused on the one genuinely viewer-specific Floor filter.
  if (filter !== 'mygoats') {
    return Response.json({ error: 'Only the mygoats filter is dynamic' }, { status: 400 });
  }
  if (!locals.user) {
    return Response.json({ events: [] }, {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  }
  const events = await getFloorEvents({ filter, userId: locals.user.id, limit: 40 });
  return Response.json({ events }, {
    headers: { 'Cache-Control': 'private, no-store' },
  });
};

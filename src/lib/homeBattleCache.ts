export const HOME_BATTLE_CACHE_CONTROL = 'public, max-age=15, s-maxage=30';

/**
 * Cache API hits can carry a zone-level Browser Cache TTL instead of the
 * response's original max-age. Reassert the route contract before returning
 * the cached body so browsers never retain live tallies for that zone TTL.
 */
export function withHomeBattleCacheStatus(
  response: Response,
  status: 'HIT' | 'MISS',
): Response {
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', HOME_BATTLE_CACHE_CONTROL);
  headers.set('X-GOATSBattle-Cache', status);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

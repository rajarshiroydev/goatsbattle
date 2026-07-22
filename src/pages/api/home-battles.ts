import type { APIRoute } from 'astro';
import { z } from 'zod';
import { getBattleSummaries } from '../../lib/queries';
import { slugSchema } from '../../lib/apiValidation';
import {
  HOME_BATTLE_CACHE_CONTROL,
  withHomeBattleCacheStatus,
} from '../../lib/homeBattleCache';

export const prerender = false;

/** Matches the carousel's deck size — the homepage never asks for more. */
const battlesSchema = z.array(slugSchema).min(1).max(8);

const json = (data: unknown, status = 200, cacheControl = HOME_BATTLE_CACHE_CONTROL) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      // Short edge cache: homepage tallies drift far slower than page views,
      // and every anonymous visitor asks for the same handful of battles.
      'Cache-Control': cacheControl,
    },
  });

/**
 * Live tallies for the homepage marquee carousel. The page itself is a static
 * zero-tally shell, so battle tallies only touch the database after the island
 * mounts and only on a cache miss.
 */
type EdgeCacheStorage = CacheStorage & { default?: Cache };

function edgeCache(): Cache | null {
  if (typeof globalThis.caches === 'undefined') return null;
  return (globalThis.caches as EdgeCacheStorage).default ?? null;
}

function cacheKey(url: URL, slugs: string[]): Request {
  const canonical = new URL(url);
  canonical.search = '';
  for (const slug of [...new Set(slugs)].sort()) canonical.searchParams.append('battle', slug);
  return new Request(canonical, { method: 'GET' });
}

export const GET: APIRoute = async ({ url }) => {
  const parsed = battlesSchema.safeParse(url.searchParams.getAll('battle'));
  if (!parsed.success) return json(
    { error: 'one to eight valid battle params required' },
    400,
    'no-store',
  );

  // Cache API is route-scoped: enabling Workers caching for the Astro default
  // entrypoint would also make unrelated 200 responses heuristically cacheable.
  const cache = edgeCache();
  const key = cacheKey(url, parsed.data);
  let cached: Response | undefined;
  try {
    cached = await cache?.match(key);
  } catch (err) {
    console.error('home-battles cache read failed:', err);
  }
  if (cached) return withHomeBattleCacheStatus(cached, 'HIT');

  // Non-critical decoration: a transient neon-http hiccup must leave the
  // already-rendered static deck standing rather than 500 the fetch.
  try {
    const summaries = await getBattleSummaries(parsed.data);
    const response = json(summaries.map((s) => ({
      slug: s.slug,
      leftPct: s.pctA,
      total: s.total,
    })));
    if (cache) {
      try {
        await cache.put(key, response.clone());
      } catch (err) {
        // The live response is still valid when the optional edge cache fails.
        console.error('home-battles cache write failed:', err);
      }
    }
    return withHomeBattleCacheStatus(response, 'MISS');
  } catch (err) {
    console.error('home-battles query failed:', err);
    return json({ error: 'battle tallies temporarily unavailable' }, 503, 'no-store');
  }
};

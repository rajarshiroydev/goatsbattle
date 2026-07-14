import type { APIRoute } from 'astro';
import { allBattlePairs, allEntities } from '../data';
import { archiveMatches } from '../data/archiveMatches';
import { worldCup2026Fixtures } from '../data/worldCup2026';
import { getBattleId } from '../lib/battle';

export const prerender = true;

const PRIMARY_PATHS = [
  '/', '/world-cup', '/floor', '/goats', '/arenas', '/rankings', '/faceoff', '/play',
  '/arenas/football', '/arenas/cricket', '/arenas/tennis', '/arenas/f1',
  '/rankings/football', '/rankings/cricket', '/rankings/tennis', '/rankings/f1',
  '/privacy', '/terms', '/rules',
];

const escapeXml = (value: string) => value
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&apos;');

export const GET: APIRoute = ({ site }) => {
  const origin = site ?? new URL('https://goatsbattle.com');
  const paths = new Set<string>([
    ...PRIMARY_PATHS,
    ...allEntities.map((entity) => `/goats/${entity.slug}`),
    ...allBattlePairs.map(([a, b]) => `/battle/${getBattleId(a, b)}`),
    ...worldCup2026Fixtures.map((fixture) => `/floor/${fixture.id}`),
    ...archiveMatches.map((match) => `/floor/${match.id}`),
  ]);
  const urls = [...paths]
    .sort()
    .map((pathname) => `  <url><loc>${escapeXml(new URL(pathname, origin).toString())}</loc></url>`)
    .join('\n');
  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
  return new Response(body, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
};

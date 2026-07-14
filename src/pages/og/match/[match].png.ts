import type { APIRoute } from 'astro';
import { worldCup2026Fixtures } from '../../../data/worldCup2026';
import { renderMatchOg } from '../../../lib/og';

const launchMatches = worldCup2026Fixtures.filter((fixture) => fixture.matchNumber >= 101);

export function getStaticPaths() {
  return launchMatches.map((fixture) => ({ params: { match: fixture.id }, props: { fixture } }));
}

export const GET: APIRoute = async ({ props }) => {
  const fixture = props.fixture as (typeof launchMatches)[number] | undefined;
  if (!fixture) return new Response('Not found', { status: 404 });
  const png = await renderMatchOg(fixture);
  return new Response(new Uint8Array(png), {
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
};

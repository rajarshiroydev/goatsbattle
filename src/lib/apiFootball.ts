/**
 * Thin API-Football (v3) client — used ONLY by the offline sync script
 * (scripts/sync-matches.ts), never at request time. The free tier is 100
 * requests/day, so match data is backfilled into Postgres and served from
 * there; nothing here runs in the Astro request path.
 *
 * Auth: direct api-sports.io host with the `x-apisports-key` header. The key is
 * read the same way as every other secret (process.env first for node scripts,
 * import.meta.env as the Vite-dev fallback; both static — no optional chaining).
 * Docs: https://www.api-football.com/documentation-v3
 */

const BASE_URL = 'https://v3.football.api-sports.io';

const API_KEY = process.env.API_FOOTBALL_KEY ?? import.meta.env.API_FOOTBALL_KEY;

/** Subset of a /fixtures item we consume. */
export interface ApiFixture {
  fixture: {
    id: number;
    date: string; // ISO
    status: { short: string; long: string };
    venue: { name: string | null; city: string | null };
  };
  league: { id: number; season: number; round: string; name: string };
  teams: {
    home: { id: number; name: string };
    away: { id: number; name: string };
  };
  goals: { home: number | null; away: number | null };
  score: { penalty: { home: number | null; away: number | null } };
}

/** Subset of a /fixtures/events item we consume. */
export interface ApiEvent {
  time: { elapsed: number | null; extra: number | null };
  team: { id: number; name: string };
  player: { id: number | null; name: string | null };
  type: string; // Goal | Card | subst | Var
  detail: string; // Normal Goal | Penalty | Yellow Card | ...
  comments: string | null;
}

interface ApiEnvelope<T> {
  errors: unknown;
  results: number;
  response: T[];
}

async function apiGet<T>(path: string, params: Record<string, string | number>): Promise<T[]> {
  if (!API_KEY) {
    throw new Error('API_FOOTBALL_KEY is not set. Add it to your .env file.');
  }
  const qs = new URLSearchParams(
    Object.entries(params).map(([k, v]) => [k, String(v)]),
  ).toString();
  const res = await fetch(`${BASE_URL}${path}?${qs}`, {
    headers: { 'x-apisports-key': API_KEY },
  });
  if (!res.ok) {
    throw new Error(`API-Football ${path} failed: ${res.status} ${res.statusText}`);
  }
  const remaining = res.headers.get('x-ratelimit-requests-remaining');
  if (remaining !== null) {
    process.stdout.write(`  (api quota remaining today: ${remaining})\n`);
  }
  const body = (await res.json()) as ApiEnvelope<T>;
  // API-Football returns 200 with an `errors` object on plan/param problems.
  const errs = body.errors;
  const hasErrors = Array.isArray(errs) ? errs.length > 0 : errs && Object.keys(errs).length > 0;
  if (hasErrors) {
    throw new Error(`API-Football ${path} returned errors: ${JSON.stringify(errs)}`);
  }
  return body.response;
}

/** All fixtures for a league + season (one request returns the whole set). */
export function getFixtures(league: number, season: number): Promise<ApiFixture[]> {
  return apiGet<ApiFixture>('/fixtures', { league, season });
}

/** Timeline events (goals, cards, subs, VAR) for a single fixture. */
export function getFixtureEvents(fixtureId: number): Promise<ApiEvent[]> {
  return apiGet<ApiEvent>('/fixtures/events', { fixture: fixtureId });
}

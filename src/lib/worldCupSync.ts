import { neon } from '@neondatabase/serverless';
import { worldCup2026Fixtures } from '../data/worldCup2026';
import {
  validateWorldCupCommunityPayload,
  type WorldCupCommunityMatch,
  type WorldCupMatchStatus,
} from './worldCupProvider';

const PROVIDER_URL = 'https://worldcup26.ir/get/games';
const POLL_BEFORE_MS = 60 * 60 * 1_000;
const POLL_AFTER_MS = 4 * 60 * 60 * 1_000;

export function fixturesInScoreWindow(now: Date) {
  const timestamp = now.getTime();
  return worldCup2026Fixtures.filter((fixture) => {
    const kickoff = new Date(fixture.kickoff).getTime();
    return timestamp >= kickoff - POLL_BEFORE_MS && timestamp <= kickoff + POLL_AFTER_MS;
  });
}

export function isDailyMetadataWindow(now: Date) {
  return now.getUTCHours() === 0 && now.getUTCMinutes() < 2;
}

export function assertSafeStatusTransition(
  previous: WorldCupMatchStatus,
  next: WorldCupMatchStatus,
) {
  const allowed: Readonly<Record<WorldCupMatchStatus, readonly WorldCupMatchStatus[]>> = {
    scheduled: ['scheduled', 'live', 'finished'],
    live: ['live', 'finished'],
    finished: ['finished'],
  };
  if (!allowed[previous].includes(next)) {
    throw new Error(`Refusing World Cup status regression from ${previous} to ${next}.`);
  }
}

async function fetchProvider(fetcher: typeof fetch) {
  const response = await fetcher(PROVIDER_URL, {
    headers: { accept: 'application/json', 'user-agent': 'GOATSBattle/1.0' },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Community provider returned HTTP ${response.status}.`);
  return validateWorldCupCommunityPayload(await response.json());
}

type ExistingMatch = {
  providerFixtureId: string;
  status: WorldCupMatchStatus;
};

export type WorldCupRefreshResult = {
  outcome: 'skipped' | 'updated';
  checked: number;
  updated: number;
};

export async function refreshWorldCupScores(options: {
  databaseUrl: string;
  now: Date;
  fetcher?: typeof fetch;
}): Promise<WorldCupRefreshResult> {
  const active = fixturesInScoreWindow(options.now);
  const metadataWindow = isDailyMetadataWindow(options.now);
  if (active.length === 0 && !metadataWindow) return { outcome: 'skipped', checked: 0, updated: 0 };

  const providerGames = await fetchProvider(options.fetcher ?? fetch);
  const providerByNumber = new Map(providerGames.map((game) => [game.matchNumber, game]));
  const targetFixtures = active.length > 0
    ? active
    : worldCup2026Fixtures.filter((fixture) => fixture.status === 'scheduled');
  const targetProviderIds = targetFixtures.map((fixture) => fixture.providerFixtureId);

  const query = neon(options.databaseUrl);
  const existingRows = await query.query(
    `SELECT provider_fixture_id AS "providerFixtureId", status
     FROM matches
     WHERE provider = 'worldcup26-community'
       AND provider_fixture_id = ANY($1::text[])`,
    [targetProviderIds],
  ) as ExistingMatch[];
  if (existingRows.length !== targetFixtures.length) {
    throw new Error(`Expected ${targetFixtures.length} target matches in the database; found ${existingRows.length}.`);
  }
  const existingByProviderId = new Map(existingRows.map((row) => [row.providerFixtureId, row]));

  const updates: Array<{
    fixtureId: string;
    expectedStatus: WorldCupMatchStatus;
    game: WorldCupCommunityMatch;
  }> = [];
  for (const fixture of targetFixtures) {
    const game = providerByNumber.get(fixture.matchNumber);
    const existing = existingByProviderId.get(fixture.providerFixtureId);
    if (!game || !existing) throw new Error(`Missing validated state for match ${fixture.matchNumber}.`);
    assertSafeStatusTransition(existing.status, game.status);
    updates.push({ fixtureId: fixture.providerFixtureId, expectedStatus: existing.status, game });
  }

  // All transitions are validated before the first write. Each update preserves
  // canonical kickoff/venue and touches score/status/team identity only.
  for (const { fixtureId, expectedStatus, game } of updates) {
    const updated = await query`
      UPDATE matches
      SET home_team = COALESCE(${game.homeTeam}, home_team),
          away_team = COALESCE(${game.awayTeam}, away_team),
          home_score = ${game.homeScore},
          away_score = ${game.awayScore},
          status = ${game.status},
          source_status = 'fresh',
          last_synced_at = ${options.now}
      WHERE provider = 'worldcup26-community'
        AND provider_fixture_id = ${fixtureId}
        AND status = ${expectedStatus}
        AND (last_synced_at IS NULL OR last_synced_at <= ${options.now})
      RETURNING id
    `;
    if (updated.length === 0) {
      throw new Error(`Concurrent score refresh superseded ${fixtureId}.`);
    }
  }

  return { outcome: 'updated', checked: providerGames.length, updated: updates.length };
}

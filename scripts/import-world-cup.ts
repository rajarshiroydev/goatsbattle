import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { sql } from 'drizzle-orm';
import { worldCup2026Fixtures } from '../src/data/worldCup2026';
import { matches } from '../src/lib/db/schema';
import { validateWorldCupCommunityPayload } from '../src/lib/worldCupProvider';
import { exitOnDatabaseError, runDatabaseOperation } from './lib/database-safety';

const PROVIDER_URL = 'https://worldcup26.ir/get/games';

async function fetchEnrichment() {
  const response = await fetch(PROVIDER_URL, {
    headers: { accept: 'application/json', 'user-agent': 'GOATSBattle/1.0' },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Community provider returned HTTP ${response.status}.`);
  return validateWorldCupCommunityPayload(await response.json());
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is not set.');
  const query = neon(connectionString);
  const database = drizzle(query);

  let enrichment = null;
  try {
    enrichment = await fetchEnrichment();
    console.log('✓ Validated optional score/status enrichment for all 104 matches.');
  } catch (error) {
    console.warn(`⚠ Provider unavailable or invalid; importing canonical fallback: ${String(error)}`);
  }

  const enrichedByNumber = new Map(enrichment?.map((game) => [game.matchNumber, game]) ?? []);
  const syncedAt = enrichment ? new Date() : null;
  const rows = worldCup2026Fixtures.map((canonical) => {
    const provider = enrichedByNumber.get(canonical.matchNumber);
    return {
      id: canonical.id,
      externalId: null,
      provider: 'worldcup26-community',
      providerFixtureId: canonical.providerFixtureId,
      tournamentStage: canonical.stage,
      sourceStatus: provider ? 'fresh' : 'canonical-fallback',
      lastSyncedAt: syncedAt,
      arena: 'football',
      competition: 'FIFA World Cup 2026',
      homeTeam: provider?.homeTeam ?? canonical.homeTeam,
      awayTeam: provider?.awayTeam ?? canonical.awayTeam,
      homeCode: canonical.homeCode,
      awayCode: canonical.awayCode,
      homeScore: provider ? provider.homeScore : canonical.homeScore,
      awayScore: provider ? provider.awayScore : canonical.awayScore,
      kickoff: new Date(canonical.kickoff),
      status: provider?.status ?? canonical.status,
      venue: canonical.venue,
    };
  });

  await database.insert(matches).values(rows).onConflictDoUpdate({
    target: matches.id,
    set: {
      provider: sql`excluded.provider`,
      providerFixtureId: sql`excluded.provider_fixture_id`,
      tournamentStage: sql`excluded.tournament_stage`,
      sourceStatus: sql`CASE
        WHEN excluded.last_synced_at IS NULL AND ${matches.lastSyncedAt} IS NOT NULL
          THEN ${matches.sourceStatus}
        ELSE excluded.source_status END`,
      lastSyncedAt: sql`COALESCE(excluded.last_synced_at, ${matches.lastSyncedAt})`,
      arena: sql`excluded.arena`,
      competition: sql`excluded.competition`,
      homeTeam: sql`CASE
        WHEN excluded.last_synced_at IS NULL AND ${matches.lastSyncedAt} IS NOT NULL
          THEN ${matches.homeTeam}
        ELSE excluded.home_team END`,
      awayTeam: sql`CASE
        WHEN excluded.last_synced_at IS NULL AND ${matches.lastSyncedAt} IS NOT NULL
          THEN ${matches.awayTeam}
        ELSE excluded.away_team END`,
      homeCode: sql`excluded.home_code`,
      awayCode: sql`excluded.away_code`,
      homeScore: sql`CASE
        WHEN excluded.last_synced_at IS NULL AND ${matches.lastSyncedAt} IS NOT NULL
          THEN ${matches.homeScore}
        ELSE excluded.home_score END`,
      awayScore: sql`CASE
        WHEN excluded.last_synced_at IS NULL AND ${matches.lastSyncedAt} IS NOT NULL
          THEN ${matches.awayScore}
        ELSE excluded.away_score END`,
      kickoff: sql`excluded.kickoff`,
      status: sql`CASE
        WHEN excluded.last_synced_at IS NULL AND ${matches.lastSyncedAt} IS NOT NULL
          THEN ${matches.status}
        ELSE excluded.status END`,
      venue: sql`excluded.venue`,
    },
  });

  const [verification] = await query`
    SELECT
      count(*)::int AS count,
      count(DISTINCT provider_fixture_id)::int AS "uniqueProviderIds",
      count(*) FILTER (WHERE tournament_stage = 'group')::int AS "groupCount",
      count(*) FILTER (WHERE tournament_stage = 'round-of-32')::int AS "roundOf32Count",
      count(*) FILTER (WHERE tournament_stage = 'round-of-16')::int AS "roundOf16Count",
      count(*) FILTER (WHERE tournament_stage = 'quarterfinal')::int AS "quarterfinalCount",
      count(*) FILTER (WHERE tournament_stage = 'semifinal')::int AS "semifinalCount",
      count(*) FILTER (WHERE tournament_stage = 'third-place')::int AS "thirdPlaceCount",
      count(*) FILTER (WHERE tournament_stage = 'final')::int AS "finalCount"
    FROM matches
    WHERE competition = 'FIFA World Cup 2026'
  `;
  const expected = {
    count: 104, uniqueProviderIds: 104, groupCount: 72, roundOf32Count: 16,
    roundOf16Count: 8, quarterfinalCount: 4, semifinalCount: 2,
    thirdPlaceCount: 1, finalCount: 1,
  };
  for (const [field, value] of Object.entries(expected)) {
    if (Number(verification[field]) !== value) {
      throw new Error(`World Cup verification failed for ${field}: expected ${value}, received ${String(verification[field])}.`);
    }
  }

  const [duplicateMoments] = await query`
    SELECT count(*)::int AS count FROM (
      SELECT provider, provider_event_id
      FROM match_moments
      WHERE provider IS NOT NULL AND provider_event_id IS NOT NULL
      GROUP BY provider, provider_event_id
      HAVING count(*) > 1
    ) duplicates
  `;
  if (Number(duplicateMoments.count) !== 0) throw new Error('Duplicate provider event identities exist.');

  console.log(`✓ Idempotently imported and verified ${verification.count} World Cup matches.`);
  console.log(`✓ Unique provider fixtures: ${verification.uniqueProviderIds}; duplicate provider events: 0.`);
}

runDatabaseOperation({ operation: 'World Cup 2026 fixture import' }, main)
  .catch(exitOnDatabaseError);

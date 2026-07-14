/** Attach TheStatsAPI identities and verified score state to all 104 matches. */
import { neon } from '@neondatabase/serverless';
import { worldCup2026Fixtures } from '../src/data/worldCup2026';
import {
  THE_STATS_API_PROVIDER,
  displayProviderTeamName,
  displayScore,
  mapStatsApiWorldCupMatches,
} from '../src/lib/theStatsApi';
import { fetchStatsApiWorldCupMatches } from '../src/lib/theStatsApiClient';
import { reserveStatsApiRequest } from '../src/lib/theStatsApiSync';
import { exitOnDatabaseError, runDatabaseOperation } from './lib/database-safety';

async function main() {
  const connectionString = process.env.DATABASE_URL;
  const apiKey = process.env.THESTATSAPI_API_KEY;
  if (!connectionString) throw new Error('DATABASE_URL is not set.');
  if (!apiKey) throw new Error('THESTATSAPI_API_KEY is not set.');
  const query = neon(connectionString);
  const now = new Date();
  const providerMatches = await fetchStatsApiWorldCupMatches({
    apiKey,
    reserveRequest: async (path) => {
      await reserveStatsApiRequest(query, now, path);
    },
  });
  const mapped = mapStatsApiWorldCupMatches(providerMatches, worldCup2026Fixtures);
  console.log('✓ Validated and canonically mapped 104 unique TheStatsAPI fixtures before writing.');

  const rows = mapped.map(({ fixture, provider }) => {
    const score = displayScore(provider.score);
    return {
      matchId: fixture.id,
      providerMatchId: provider.id,
      providerStatus: provider.status === 'live'
        ? 'live'
        : provider.status === 'finished'
          ? 'finished'
          : 'scheduled',
      homeTeam: displayProviderTeamName(provider.homeTeam.name, fixture.homeTeam),
      awayTeam: displayProviderTeamName(provider.awayTeam.name, fixture.awayTeam),
      homeScore: score.home,
      awayScore: score.away,
      homePenaltyScore: score.penaltiesHome,
      awayPenaltyScore: score.penaltiesAway,
      metadata: {
        homeTeamId: provider.homeTeam.id,
        awayTeamId: provider.awayTeam.id,
        providerKickoff: provider.kickoff,
        providerStage: provider.stageName,
      },
    };
  });

  const [existing] = await query`
    SELECT count(*)::int AS count
    FROM matches
    WHERE competition = 'FIFA World Cup 2026'
  `;
  if (Number(existing.count) !== 104) {
    throw new Error(`Expected 104 canonical World Cup rows before source import; found ${String(existing.count)}.`);
  }

  await query.query(
    `WITH incoming AS (
       SELECT * FROM jsonb_to_recordset($1::jsonb) AS item(
         "matchId" text, "providerMatchId" text, "providerStatus" text,
         "homeTeam" text, "awayTeam" text, "homeScore" integer, "awayScore" integer,
         "homePenaltyScore" integer, "awayPenaltyScore" integer, metadata jsonb
       )
     )
     INSERT INTO match_sources (
       match_id, provider, provider_match_id, role, status, metadata,
       last_attempt_at, last_success_at, created_at, updated_at
     )
     SELECT incoming."matchId", $2, incoming."providerMatchId", roles.role,
            'active', incoming.metadata, $3, $3, $3, $3
     FROM incoming
     CROSS JOIN (VALUES ('score'), ('timeline'), ('lineup')) AS roles(role)
     ON CONFLICT (match_id, provider, role) DO UPDATE SET
       provider_match_id = excluded.provider_match_id,
       status = 'active',
       metadata = excluded.metadata,
       last_attempt_at = excluded.last_attempt_at,
       last_success_at = excluded.last_success_at,
       updated_at = excluded.updated_at`,
    [JSON.stringify(rows), THE_STATS_API_PROVIDER, now],
  );

  await query.query(
    `WITH incoming AS (
       SELECT * FROM jsonb_to_recordset($1::jsonb) AS item(
         "matchId" text, "providerMatchId" text, "providerStatus" text,
         "homeTeam" text, "awayTeam" text, "homeScore" integer, "awayScore" integer,
         "homePenaltyScore" integer, "awayPenaltyScore" integer, metadata jsonb
       )
     )
     UPDATE matches match SET
       home_team = incoming."homeTeam",
       away_team = incoming."awayTeam",
       home_score = incoming."homeScore",
       away_score = incoming."awayScore",
       home_penalty_score = incoming."homePenaltyScore",
       away_penalty_score = incoming."awayPenaltyScore",
       status = incoming."providerStatus",
       source_status = 'fresh',
       last_synced_at = $2
     FROM incoming
     WHERE match.id = incoming."matchId"`,
    [JSON.stringify(rows), now],
  );

  const verification = await query.query(
    `SELECT role, count(*)::int AS count,
            count(DISTINCT provider_match_id)::int AS "uniqueProviderIds"
     FROM match_sources
     WHERE provider = $1
     GROUP BY role ORDER BY role`,
    [THE_STATS_API_PROVIDER],
  ) as Array<{ role: string; count: number; uniqueProviderIds: number }>;
  for (const role of ['lineup', 'score', 'timeline']) {
    const row = verification.find((item) => item.role === role);
    if (Number(row?.count) !== 104 || Number(row?.uniqueProviderIds) !== 104) {
      throw new Error(`TheStatsAPI ${role} source verification failed: ${JSON.stringify(row)}.`);
    }
  }
  console.log('✓ Imported 104 unique score, timeline, and lineup source mappings.');
  console.log('✓ Canonical kickoff, venue, stage, route, and match number were not modified.');
}

runDatabaseOperation({ operation: 'TheStatsAPI World Cup source import' }, main)
  .catch(exitOnDatabaseError);
